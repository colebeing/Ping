import type { Env, Frequency } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { acceptRecommendation, declineRecommendation } from "../recommendations";
import { scheduleUserPush } from "../scheduler";

export async function handleListRecommendations(_request: Request, env: Env, userId: string): Promise<Response> {
  const state = await getState(env, userId);
  const pending = state.pendingNudges.filter((n) => n.kind === "recommendation");
  return json({ pending, active: state.activeOverrides, retired: state.retiredOverrides });
}

export async function handleAcceptRecommendation(_request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const state = await getState(env, userId);
  const ok = await acceptRecommendation(env, state, id);
  if (!ok) return errorResponse("Recommendation not found", 404);
  await saveState(env, userId, state);
  return json({ ok: true, active: state.activeOverrides });
}

export async function handleDeclineRecommendation(_request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const state = await getState(env, userId);
  const ok = declineRecommendation(state, id);
  if (!ok) return errorResponse("Recommendation not found", 404);
  await saveState(env, userId, state);
  return json({ ok: true });
}

interface CadenceBody {
  block1?: string;
  block2?: string;
  block3?: string;
  block4?: string;
  timezone?: string;
  frequency?: Frequency;
}

// Also the grace period today.ts protects after each check-in time before
// the next block takes over as "current" — a block owns from the end of the
// previous block's window through this many minutes after its own time, so
// times closer together than this would leave no real window for one block.
const MIN_GAP_MINUTES = 120;

function minutesOf(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return (hh % 24) * 60 + (mm || 0);
}

/** Times must run in increasing order through the day, and every pair (including wrapping past midnight) must be at least MIN_GAP_MINUTES apart. */
function checkInTimesError(times: string[]): string | null {
  const minutes = times.map(minutesOf);
  for (let i = 1; i < minutes.length; i++) {
    if (minutes[i] <= minutes[i - 1]) return "Check-in times must be in order, earliest to latest";
  }
  for (let i = 0; i < minutes.length; i++) {
    for (let j = i + 1; j < minutes.length; j++) {
      const diff = Math.abs(minutes[i] - minutes[j]);
      if (Math.min(diff, 1440 - diff) < MIN_GAP_MINUTES) return "Check-in times must each be at least two hours apart";
    }
  }
  return null;
}

export async function handleUpdateCadence(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<CadenceBody>(request);
  const state = await getState(env, userId);
  const next = { ...state.cadence };
  if (body.block1) next.block1 = body.block1;
  if (body.block2) next.block2 = body.block2;
  if (body.block3) next.block3 = body.block3;
  if (body.block4) next.block4 = body.block4;
  if (body.timezone) next.timezone = body.timezone;
  if (body.frequency === "once" || body.frequency === "twice" || body.frequency === "four") next.frequency = body.frequency;

  if (next.frequency === "twice") {
    const err = checkInTimesError([next.block1, next.block2]);
    if (err) return errorResponse(err, 400);
  } else if (next.frequency === "four") {
    if (!next.block1 || !next.block2 || !next.block3 || !next.block4) {
      return errorResponse("4x Daily needs all four check-in times", 400);
    }
    const err = checkInTimesError([next.block1, next.block2, next.block3, next.block4]);
    if (err) return errorResponse(err, 400);
  }

  state.cadence = next;
  await saveState(env, userId, state);
  await scheduleUserPush(env, userId);
  return json({ cadence: state.cadence });
}
