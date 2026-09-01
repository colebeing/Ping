import Capacitor

/// Local, unpublished plugin — just a JS-to-native handoff for the device token returned by
/// /api/push/register-fcm. Not distributed via npm; registered in PingBridgeViewController.
/// Mirrors android/.../PingAuthPlugin.kt exactly.
@objc(PingAuthPlugin)
public class PingAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PingAuthPlugin"
    public let jsName = "PingAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "storeDeviceToken", returnType: CAPPluginReturnPromise)
    ]

    @objc func storeDeviceToken(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty else {
            call.reject("value is required")
            return
        }
        DeviceTokenStore.store(value)
        call.resolve()
    }
}
