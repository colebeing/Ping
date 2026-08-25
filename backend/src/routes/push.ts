import type { Env, PushSubscriptionJSON } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { scheduleUserPush } from "../scheduler";

export async function handleSubscribe(request: Request, env: Env, userId: string): Promise<Response> {
  const subscription = await readJson<PushSubscriptionJSON>(request);
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return errorResponse("Invalid push subscription", 400);
  }
  const state = await getState(env, userId);
  if (!state.pushSubscriptions.some((s) => s.endpoint === subscription.endpoint)) {
    state.pushSubscriptions.push(subscription);
    await saveState(env, userId, state);
  }
  await scheduleUserPush(env, userId);
  return json({ ok: true });
}

export async function handleGetVapidPublicKey(_request: Request, env: Env): Promise<Response> {
  return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
}
