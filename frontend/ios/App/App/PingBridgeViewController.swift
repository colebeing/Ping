import Capacitor

/// Local plugins compiled straight into the app target (PingAuthPlugin, PingPushPlugin — not
/// distributed via npm/SPM) aren't auto-discovered by the bridge the way an installed Capacitor
/// plugin package is; they need explicit registerPluginInstance() in a capacitorDidLoad() override.
/// SceneDelegate.swift instantiates this instead of the stock CAPBridgeViewController.
class PingBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PingAuthPlugin())
        bridge?.registerPluginInstance(PingPushPlugin())
    }
}
