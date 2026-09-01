import Capacitor
import FirebaseMessaging

/// Local, unpublished plugin, no Android counterpart. @capacitor/push-notifications' "registration"
/// event hands back an FCM token on Android but only the raw APNs device token on iOS — Firebase
/// derives the real FCM token from that (fed in via AppDelegate's
/// didRegisterForRemoteNotificationsWithDeviceToken), read back here so push-setup.ts can register it
/// with the backend the same way on both platforms.
@objc(PingPushPlugin)
public class PingPushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PingPushPlugin"
    public let jsName = "PingPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getFcmToken", returnType: CAPPluginReturnPromise)
    ]

    @objc func getFcmToken(_ call: CAPPluginCall) {
        Messaging.messaging().token { token, error in
            if let token = token {
                call.resolve(["value": token])
            } else {
                call.reject(error?.localizedDescription ?? "no FCM token")
            }
        }
    }
}
