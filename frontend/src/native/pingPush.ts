import { registerPlugin } from "@capacitor/core";

interface PingPushPlugin {
  getFcmToken(): Promise<{ value: string }>;
}

// Backed by ios/App/App/PingPushPlugin.swift — a local, unpublished plugin, not an npm package.
// @capacitor/push-notifications' "registration" event hands back an FCM token on Android but only
// the raw APNs device token on iOS; this reads the real FCM token Firebase derives from that.
export const PingPush = registerPlugin<PingPushPlugin>("PingPush");
