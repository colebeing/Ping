import type { Env, Frequency } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { acceptRecommendation } from "../recommendations";
import { scheduleUserPush } from "../scheduler";

export async function handleListRecommendations(_request: Request, env: Env, userId: string): Promise<Response> {
  const state = await getState(env, userId);
  return json({ pending: state.pendingRecommendations, active: state.activeOverrides, retired: state.retiredOverrides });
}

export async function handleAcceptRecommendation(_request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const state = await getState(env, userId);
  const ok = await acceptRecommendation(env, state, id);
  if (!ok) return errorResponse("Recommendation not found", 404);
  await saveState(env, userId, state);
  return json({ ok: true, active: state.activeOverrides });
}

interface CadenceBody {
  block1?: string;
  block2?: string;
  block3?: string;
  block4?: string;
  timezone?: string;
  frequency?: Frequency;
}

const MIN_GAP_MINUTES = 60;

function minutesOf(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return (hh % 24) * 60 + (mm || 0);
}

/** Every pair of times must be at least MIN_GAP_MINUTES apart, measured the short way around the 24h clock. */
function hasMinGapApart(times: string[]): boolean {
  const minutes = times.map(minutesOf);
  for (let i = 0; i < minutes.length; i++) {
    for (let j = i + 1; j < minutes.length; j++) {
      const diff = Math.abs(minutes[i] - minutes[j]);
      if (Math.min(diff, 1440 - diff) < MIN_GAP_MINUTES) return false;
    }
  }
  return true;
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

  if (next.frequency === "four") {
    if (!next.block1 || !next.block2 || !next.block3 || !next.block4) {
      return errorResponse("4x Daily needs all four check-in times", 400);
    }
    if (!hasMinGapApart([next.block1, next.block2, next.block3, next.block4])) {
      return errorResponse("4x Daily check-in times must each be at least an hour apart", 400);
    }
  }

  state.cadence = next;
  await saveState(env, userId, state);
  await scheduleUserPush(env, userId);
  return json({ cadence: state.cadence });
}
