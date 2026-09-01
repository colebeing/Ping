import Foundation
import Security

/// Holds the long-lived device token the backend mints when the app registers its FCM token
/// (see /api/push/register-fcm). Keychain-backed since it authenticates as the full user identity
/// with no expiry — the iOS analog of Android's EncryptedSharedPreferences-backed DeviceTokenStore.kt.
/// Read by PingNotificationDelegate, written by PingAuthPlugin.
enum DeviceTokenStore {
    private static let service = "com.colebeing.ping.devicetoken"
    private static let account = "device_token"

    static func store(_ token: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = Data(token.utf8)
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
