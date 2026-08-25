import type { Env } from "../types";
import { json } from "../http";
import { getState } from "../state";

export async function handleMe(_request: Request, env: Env, userId: string): Promise<Response> {
  const state = await getState(env, userId);
  return json({ email: userId, cadence: state.cadence, pushSubscriptionCount: state.pushSubscriptions.length });
}
