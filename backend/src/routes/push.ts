import { isBlockId, type BlockId, type Env, type PushSubscriptionJSON } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { scheduleUserPush } from "../scheduler";
import { sendTestPush } from "../push";

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

export async function handleTestPush(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<{ block?: BlockId }>(request);
  const block: BlockId = isBlockId(body.block) ? body.block : "1";
  const result = await sendTestPush(env, userId, block);
  if (!result.ok) return errorResponse(result.reason ?? "Couldn't send test push", 400);
  return json({ ok: true });
}
