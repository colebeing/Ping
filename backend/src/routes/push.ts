import { isBlockId, type BlockId, type Env, type PushSubscriptionJSON } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { scheduleUserPush } from "../scheduler";
import { sendTestPush, recordNotificationClicked } from "../push";
import { createDeviceToken } from "../auth";

interface SubscribeBody {
  subscription: PushSubscriptionJSON;
  /** Free-form client-reported platform info (e.g. navigator.userAgent) — the one place OS/browser info ever reaches the backend, for spotting platform-specific issues in aggregate. */
  platform?: string;
}

export async function handleSubscribe(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<SubscribeBody>(request);
  const subscription = body.subscription;
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return errorResponse("Invalid push subscription", 400);
  }
  const state = await getState(env, userId);
  if (!state.pushSubscriptions.some((s) => s.endpoint === subscription.endpoint)) {
    state.pushSubscriptions.push(subscription);
  }
  state.deviceRegistrations.push({ type: "webpush", platform: body.platform ?? "unknown", registeredAt: new Date().toISOString() });
  await saveState(env, userId, state);
  await scheduleUserPush(env, userId);
  return json({ ok: true });
}

export async function handleGetVapidPublicKey(_request: Request, env: Env): Promise<Response> {
  return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
}

/**
 * Registers the native Android wrapper's FCM token and mints a long-lived
 * device token in return — the app stores that (native-side, not JS-visible)
 * so a background notification-action tap can authenticate without a cookie.
 */
export async function handleRegisterFcmToken(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<{ fcmToken?: string; platform?: string }>(request);
  if (!body.fcmToken) return errorResponse("fcmToken is required", 400);

  const state = await getState(env, userId);
  if (!state.fcmTokens.includes(body.fcmToken)) {
    state.fcmTokens.push(body.fcmToken);
  }
  state.deviceRegistrations.push({ type: "fcm", platform: body.platform ?? "unknown", registeredAt: new Date().toISOString() });
  await saveState(env, userId, state);
  await scheduleUserPush(env, userId);

  const deviceToken = await createDeviceToken(env, userId);
  return json({ ok: true, deviceToken });
}

export async function handleTestPush(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<{ block?: BlockId }>(request);
  const block: BlockId = isBlockId(body.block) ? body.block : "1";
  const result = await sendTestPush(env, userId, block);
  if (!result.ok) return errorResponse(result.reason ?? "Couldn't send test push", 400);
  return json({ ok: true });
}

export async function handleNotificationClicked(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<{ block?: string }>(request);
  if (!isBlockId(body.block)) return errorResponse("block must be a valid block id", 400);
  await recordNotificationClicked(env, userId, body.block);
  return json({ ok: true });
}
