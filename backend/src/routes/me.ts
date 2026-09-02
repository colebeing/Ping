import type { Env } from "../types";
import { json } from "../http";
import { getState, saveState, todayLocal } from "../state";
import { getUser } from "../auth";

export async function handleMe(_request: Request, env: Env, userId: string): Promise<Response> {
  const [state, user] = await Promise.all([getState(env, userId), getUser(env, userId)]);

  // /api/me is called on every app open and every tab switch — recording
  // every hit would be noisy and mostly redundant. Only a genuine new day
  // needs a write, since this exists purely to tell "opened the app but
  // didn't check in" apart from "didn't open it at all" at day granularity.
  const today = todayLocal(state.cadence.timezone);
  if (state.appOpenDates[state.appOpenDates.length - 1] !== today) {
    state.appOpenDates.push(today);
    await saveState(env, userId, state);
  }

  return json({
    email: userId,
    cadence: state.cadence,
    pushSubscriptionCount: state.pushSubscriptions.length,
    fcmTokenCount: state.fcmTokens.length,
    isAdmin: user?.isAdmin === true,
  });
}
