import Foundation
import UserNotifications

/// Handles taps on the interactive check-in notification's action buttons, end to end, entirely in
/// native code — no dependency on the JS/webview layer, since iOS can invoke this from a fully
/// backgrounded or force-quit app. Mirrors android/.../NotificationActionReceiver.kt's role, but the
/// architecture differs: Android gets a silent data-only push and builds the *first* notification
/// itself; iOS's first notification arrives as a real APNs alert (built server-side, see
/// backend/src/fcm.ts's `apns` block) because content-available/background pushes aren't reliably
/// delivered once the app is suspended or force-quit — exactly the scenario this exists for. From the
/// Yes/No tap onward, both platforms behave the same: POST the answer, swap in a follow-up
/// notification, POST the category, swap in a confirmation.
///
/// Set as `UNUserNotificationCenter.current().delegate` directly from SceneDelegate.swift, *after*
/// `window.makeKeyAndVisible()` — Capacitor's own bridge claims that delegate slot for itself when its
/// view loads (during that same call), and registers plugin notification handling through its own
/// internal NotificationRouter, whose handler protocol has no completion-handler/async hook — fully
/// incompatible with the network-call-before-completionHandler() flow this needs. Setting our own
/// delegate after makeKeyAndVisible() deterministically overrides Capacitor's, at the cost of the
/// @capacitor/push-notifications plugin's own `pushNotificationReceived`/`pushNotificationActionPerformed`
/// JS events never firing — unused by this app's frontend (push-setup.ts only listens for
/// "registration"/"registrationError", which are unrelated NotificationCenter-based events).
public class PingNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    public static let shared = PingNotificationDelegate()

    // Keep in sync with frontend/public/sw.js's API_BASE and android's NotificationActionReceiver.kt.
    private let apiBase = "https://ping-backend.colebeing.workers.dev"

    private let questionCategory = UNNotificationCategory(
        identifier: "PING_QUESTION",
        actions: [
            UNNotificationAction(identifier: "YES_ACTION", title: "Yes", options: []),
            UNNotificationAction(identifier: "NO_ACTION", title: "No", options: []),
        ],
        intentIdentifiers: [],
        options: []
    )

    /// Fixed 2 actions regardless of which node proposed it, unlike PING_FOLLOWUP_* below (whose
    /// options vary per follow-up) — so this can be registered once, statically, just like
    /// questionCategory rather than rebuilt per notification.
    private let recommendationCategory = UNNotificationCategory(
        identifier: "PING_RECOMMENDATION",
        actions: [
            UNNotificationAction(identifier: "ACCEPT_ACTION", title: "Yes, make this my question", options: []),
            UNNotificationAction(identifier: "DECLINE_ACTION", title: "No, keep mine", options: []),
        ],
        intentIdentifiers: [],
        options: []
    )

    override private init() {
        super.init()
        UNUserNotificationCenter.current().setNotificationCategories([questionCategory, recommendationCategory])
    }

    /// setNotificationCategories replaces the *entire* registered set, not merges — every dynamic
    /// registration below must re-include questionCategory/recommendationCategory or subsequent
    /// question/recommendation pushes silently lose their actions.
    private func registerCategories(alsoInclude dynamic: UNNotificationCategory) {
        UNUserNotificationCenter.current().setNotificationCategories([questionCategory, recommendationCategory, dynamic])
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                        willPresent notification: UNNotification,
                                        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                        didReceive response: UNNotificationResponse,
                                        withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        // iOS assigns no notification-ID equivalent to Android's fixed NOTIFICATION_ID int; reuse the
        // tapped notification's own identifier so each stage's `add()` replaces it in place.
        let identifier = response.notification.request.identifier
        let block = content.userInfo["block"] as? String ?? ""

        switch content.categoryIdentifier {
        case "PING_QUESTION":
            guard response.actionIdentifier == "YES_ACTION" || response.actionIdentifier == "NO_ACTION" else {
                completionHandler()
                return
            }
            let answer = response.actionIdentifier == "YES_ACTION" ? "yes" : "no"
            post(path: "/api/answer", body: ["block": block, "answer": answer]) { [weak self] json in
                defer { completionHandler() }
                guard let self,
                      let followup = json?["followup"] as? [String: Any],
                      let options = followup["options"] as? [String: String] else { return }
                let prompt = followup["prompt"] as? String ?? "Who was it?"
                self.scheduleFollowup(identifier: identifier, block: block, answer: answer, prompt: prompt, options: options)
            }

        case let categoryId where categoryId.hasPrefix("PING_FOLLOWUP"):
            let categoryKeys: [String: String] = [
                "FOLLOWUP_FRIENDS": "friends",
                "FOLLOWUP_COLLEAGUES": "colleagues",
                "FOLLOWUP_FAMILY": "family",
                "FOLLOWUP_ME": "me",
            ]
            guard let category = categoryKeys[response.actionIdentifier] else {
                completionHandler()
                return
            }
            let answer = content.userInfo["answer"] as? String ?? ""
            let categoryLabel = (content.userInfo["categoryLabels"] as? [String: String])?[category] ?? category
            post(path: "/api/followup", body: ["block": block, "category": category]) { [weak self] json in
                defer { completionHandler() }
                guard let self else { return }
                // A streak just crossed threshold for THIS block — swap straight into the invite's own
                // yes/no confirmation instead of the plain "Logged" state, so a native install never
                // needs the app opened to resolve it (unlike Chrome push, where the user's already in
                // the app for the follow-up anyway). At most one recommendation is ever proposed per
                // block per call.
                if let recs = json?["newRecommendations"] as? [[String: Any]],
                   let rec = recs.first(where: { ($0["block"] as? String) == block }),
                   let recId = rec["id"] as? String,
                   let node = rec["node"] as? [String: Any],
                   let inviteQuestion = node["inviteQuestion"] as? String {
                    let digIn = node["digIn"] as? [String: Any]
                    let digInPrompt = digIn?["prompt"] as? String
                    let digInOptions = (digIn?["options"] as? [[String: Any]])?.enumerated().compactMap { index, option -> DigInOption? in
                        guard let label = option["label"] as? String, !label.isEmpty else { return nil }
                        return DigInOption(index: index, label: label)
                    }
                    self.scheduleRecommendation(
                        identifier: identifier,
                        id: recId,
                        inviteQuestion: inviteQuestion,
                        digInPrompt: digInPrompt,
                        digInOptions: digInOptions
                    )
                } else {
                    self.scheduleConfirmation(identifier: identifier, answer: answer, categoryLabel: categoryLabel)
                }
            }

        case "PING_RECOMMENDATION":
            guard let recommendationId = content.userInfo["recommendationId"] as? String else {
                completionHandler()
                return
            }
            // "Yes" tapped on an invite whose node has its own follow-up — show the chooser instead of
            // accepting yet; the actual accept only happens once a specific option is picked, handled
            // by the PING_DIGIN_ case below.
            if response.actionIdentifier == "ACCEPT_ACTION",
               let digInPrompt = content.userInfo["digInPrompt"] as? String,
               let digInOptionsRaw = content.userInfo["digInOptions"] as? [[String: Any]] {
                let options = digInOptionsRaw.compactMap { dict -> DigInOption? in
                    guard let index = dict["index"] as? Int, let label = dict["label"] as? String else { return nil }
                    return DigInOption(index: index, label: label)
                }
                scheduleRecommendationDigIn(identifier: identifier, recommendationId: recommendationId, prompt: digInPrompt, options: options)
                completionHandler()
                return
            }
            guard response.actionIdentifier == "ACCEPT_ACTION" || response.actionIdentifier == "DECLINE_ACTION" else {
                completionHandler()
                return
            }
            let accept = response.actionIdentifier == "ACCEPT_ACTION"
            post(path: "/api/recommendations/\(recommendationId)/\(accept ? "accept" : "decline")", body: [:]) { [weak self] _ in
                self?.scheduleRecommendationConfirmation(identifier: identifier, accepted: accept)
                completionHandler()
            }

        case let categoryId where categoryId.hasPrefix("PING_DIGIN_"):
            guard let recommendationId = content.userInfo["recommendationId"] as? String,
                  response.actionIdentifier.hasPrefix("DIGIN_OPTION_"),
                  let index = Int(response.actionIdentifier.dropFirst("DIGIN_OPTION_".count)) else {
                completionHandler()
                return
            }
            post(path: "/api/recommendations/\(recommendationId)/accept", body: ["digInChoice": index]) { [weak self] _ in
                self?.scheduleRecommendationConfirmation(identifier: identifier, accepted: true)
                completionHandler()
            }

        default:
            completionHandler()
        }
    }

    private struct DigInOption {
        let index: Int
        let label: String
    }

    /// Swaps the tapped notification for the 4-option WHY follow-up. `answer` and each option's own
    /// label are threaded into userInfo so the final confirmation step can render "Logged: Yes —
    /// Family" without a second round trip — /api/followup's response doesn't echo them back.
    private func scheduleFollowup(identifier: String, block: String, answer: String, prompt: String, options: [String: String]) {
        // Same order every time so the buttons don't shuffle between builds.
        let order: [(key: String, actionId: String)] = [
            ("friends", "FOLLOWUP_FRIENDS"),
            ("colleagues", "FOLLOWUP_COLLEAGUES"),
            ("family", "FOLLOWUP_FAMILY"),
            ("me", "FOLLOWUP_ME"),
        ]
        let actions = order.compactMap { key, actionId -> UNNotificationAction? in
            guard let label = options[key] else { return nil }
            return UNNotificationAction(identifier: actionId, title: label, options: [])
        }
        let categoryId = "PING_FOLLOWUP_\(block)"
        registerCategories(alsoInclude: UNNotificationCategory(identifier: categoryId, actions: actions, intentIdentifiers: [], options: []))

        let content = UNMutableNotificationContent()
        content.title = prompt
        content.body = "Tap who it was"
        content.categoryIdentifier = categoryId
        content.userInfo = ["block": block, "answer": answer, "categoryLabels": options]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    /// Final state after the category is picked — no actions, clears itself after ~8s. No direct
    /// equivalent of Android's setTimeoutAfter(), so this schedules its own removal.
    private func scheduleConfirmation(identifier: String, answer: String, categoryLabel: String) {
        let answerLabel = answer == "yes" ? "Yes" : "No"
        let content = UNMutableNotificationContent()
        content.title = "Logged: \(answerLabel)"
        content.body = categoryLabel
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))

        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }
    }

    /// Swaps the tapped notification for the swap invite's own yes/no confirmation, proposed the
    /// moment a streak crosses threshold in the user's own answer history. `digInPrompt`/`digInOptions`
    /// (both non-nil together, or both nil) are threaded into userInfo when this node has its own
    /// follow-up — the PING_RECOMMENDATION case above reads them back to show the chooser instead of
    /// accepting immediately.
    private func scheduleRecommendation(
        identifier: String,
        id: String,
        inviteQuestion: String,
        digInPrompt: String? = nil,
        digInOptions: [DigInOption]? = nil
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Noticed a pattern"
        content.body = inviteQuestion
        content.categoryIdentifier = "PING_RECOMMENDATION"
        var userInfo: [String: Any] = ["recommendationId": id]
        if let digInPrompt, let digInOptions {
            userInfo["digInPrompt"] = digInPrompt
            userInfo["digInOptions"] = digInOptions.map { ["index": $0.index, "label": $0.label] }
        }
        content.userInfo = userInfo
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    /// Shown when "Yes" is tapped on a swap invite whose node has its own follow-up — a dynamic
    /// per-notification category, same pattern as PING_FOLLOWUP_<block> above, since which options
    /// exist varies per invitation. Picking one posts accept with a digInChoice instead of posting
    /// accept directly.
    private func scheduleRecommendationDigIn(identifier: String, recommendationId: String, prompt: String, options: [DigInOption]) {
        let actions = options.map { UNNotificationAction(identifier: "DIGIN_OPTION_\($0.index)", title: $0.label, options: []) }
        let categoryId = "PING_DIGIN_\(recommendationId)"
        registerCategories(alsoInclude: UNNotificationCategory(identifier: categoryId, actions: actions, intentIdentifiers: [], options: []))

        let content = UNMutableNotificationContent()
        content.title = prompt
        content.body = "Tap to choose"
        content.categoryIdentifier = categoryId
        content.userInfo = ["recommendationId": recommendationId]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    /// Final state after accepting/declining the swap invite — no actions, clears itself after ~8s.
    private func scheduleRecommendationConfirmation(identifier: String, accepted: Bool) {
        let content = UNMutableNotificationContent()
        content.title = accepted ? "Switched your daily question" : "Kept your current question"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))

        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
        }
    }

    /// Returns the parsed JSON body on success (2xx), or nil on any failure — callers just leave the
    /// notification as-is, same contract as NotificationActionReceiver.kt's `post`. `[String: Any]` (not
    /// `[String: String]`) since digInChoice needs to send a real JSON number, not a string.
    private func post(path: String, body: [String: Any], completion: @escaping ([String: Any]?) -> Void) {
        guard let deviceToken = DeviceTokenStore.read(), let url = URL(string: apiBase + path) else {
            completion(nil)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(nil)
                return
            }
            completion(json)
        }.resume()
    }
}
