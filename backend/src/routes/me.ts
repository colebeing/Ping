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

  // Recommendation nudges render inline per-block (via /api/question); this is only ever the
  // notification-permission/save-account/etc. kind Home renders at the top level, at most one.
  const homeNudge = state.pendingNudges.find((n) => n.kind !== "recommendation") ?? null;

  return json({
    email: user?.email ?? null,
    createdAt: user?.createdAt ?? null,
    cadence: state.cadence,
    pushSubscriptionCount: state.pushSubscriptions.length,
    fcmTokenCount: state.fcmTokens.length,
    isAdmin: user?.isAdmin === true,
    homeNudge,
  });
}
