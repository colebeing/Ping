import type { Env } from "../types";
import { json } from "../http";
import { getState } from "../state";
import { getUser } from "../auth";

export async function handleMe(_request: Request, env: Env, userId: string): Promise<Response> {
  const [state, user] = await Promise.all([getState(env, userId), getUser(env, userId)]);
  return json({
    email: userId,
    cadence: state.cadence,
    pushSubscriptionCount: state.pushSubscriptions.length,
    fcmTokenCount: state.fcmTokens.length,
    isAdmin: user?.isAdmin === true,
  });
}
