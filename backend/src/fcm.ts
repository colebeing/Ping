import type { Env } from "./types";
import { getGoogleAccessToken, parseServiceAccount } from "./google-service-account";

export function fcmConfigured(env: Env): boolean {
  return parseServiceAccount(env) !== null;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/**
 * Sends one FCM message carrying both a data payload and platform-specific display config — FCM
 * applies only the block matching the target token's platform, so both can be set unconditionally
 * on every send. Android: `data` only (no `notification` block) so its own FirebaseMessagingService
 * fully controls the swap-in-place notification. iOS: a real APNs alert (`apns.payload.aps`) with a
 * `category` for Yes/No actions, since content-available/background pushes there aren't reliably
 * delivered once the app is suspended or force-quit — the app still replaces/rebuilds the
 * notification itself at the later follow-up/confirmation stages, same as Android.
 */
export type SendOutcome = "sent" | "failed" | "gone";

export async function sendFcmPush(env: Env, token: string, data: Record<string, string>): Promise<SendOutcome> {
  const account = parseServiceAccount(env);
  if (!account) return "failed";
  try {
    const accessToken = await getGoogleAccessToken(account, FCM_SCOPE);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          data,
          android: { priority: "high" },
          apns: {
            headers: { "apns-priority": "10" },
            payload: {
              aps: {
                alert: { title: data.title ?? "Ping", body: data.body ?? "" },
                sound: "default",
                category: "PING_QUESTION",
              },
            },
          },
        },
      }),
    });
    if (res.ok) return "sent";
    // 404 from FCM's HTTP v1 API means the token is unregistered/invalid —
    // permanently dead, not a transient failure worth retrying forever.
    if (res.status === 404) return "gone";
    console.error("FCM send failed", res.status, await res.text());
    return "failed";
  } catch (err) {
    console.error("FCM send failed", err);
    return "failed";
  }
}
