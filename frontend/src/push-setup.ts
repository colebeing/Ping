import { Capacitor } from "@capacitor/core";
import { api } from "./api";
import { PingAuth } from "./native/pingAuth";
import { PingPush } from "./native/pingPush";

function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  return Capacitor.isNativePlatform() ? enableNativePush() : enableWebPush();
}

async function enableWebPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Push isn't supported in this browser" };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Notification permission denied" };

  const { publicKey } = await api.getVapidPublicKey();
  if (!publicKey) return { ok: false, reason: "Push isn't configured on the server yet" };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.subscribePush(subscription.toJSON(), navigator.userAgent);
  return { ok: true };
}

/**
 * Notification construction/actions on native are handled entirely by native code — Kotlin
 * (PingFirebaseMessagingService + NotificationActionReceiver) on Android, Swift
 * (PingNotificationDelegate) on iOS — not this plugin. This side only requests the OS permission,
 * gets an FCM token, and hands the resulting device token back to native storage so that background
 * handler can authenticate.
 */
async function enableNativePush(): Promise<{ ok: boolean; reason?: string }> {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return { ok: false, reason: "Notification permission denied" };

  const registrationToken = await new Promise<string | null>((resolve) => {
    PushNotifications.addListener("registration", (token) => resolve(token.value));
    PushNotifications.addListener("registrationError", () => resolve(null));
    void PushNotifications.register();
  });
  if (!registrationToken) return { ok: false, reason: "Couldn't get a notification token from the device" };

  // The "registration" event's value is already an FCM token on Android. On iOS it's only the raw
  // APNs device token — Firebase derives the real FCM token from that, read back via PingPush.
  const fcmToken = Capacitor.getPlatform() === "ios" ? (await PingPush.getFcmToken()).value : registrationToken;
  if (!fcmToken) return { ok: false, reason: "Couldn't get an FCM token from the device" };

  const { deviceToken } = await api.registerFcmToken(fcmToken, Capacitor.getPlatform());
  await PingAuth.storeDeviceToken({ value: deviceToken });
  return { ok: true };
}
