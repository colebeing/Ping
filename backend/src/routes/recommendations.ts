import { LIVE_BLOCKS, isLiveBlockId, type Env, type LiveBlockId } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { acceptRecommendation, declineRecommendation } from "../recommendations";
import { scheduleUserPush } from "../scheduler";

export async function handleListRecommendations(_request: Request, env: Env, userId: string): Promise<Response> {
  const state = await getState(env, userId);
  const pending = state.pendingNudges.filter((n) => n.kind === "recommendation");
  return json({ pending, active: state.activeOverride ?? null, retired: state.retiredOverrides });
}

export async function handleAcceptRecommendation(_request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const state = await getState(env, userId);
  const ok = acceptRecommendation(state, id);
  if (!ok) return errorResponse("Recommendation not found", 404);
  await saveState(env, userId, state);
  return json({ ok: true, active: state.activeOverride ?? null });
}

export async function handleDeclineRecommendation(_request: Request, env: Env, userId: string, id: string): Promise<Response> {
  const state = await getState(env, userId);
  const ok = declineRecommendation(state, id);
  if (!ok) return errorResponse("Recommendation not found", 404);
  await saveState(env, userId, state);
  return json({ ok: true });
}

interface CadenceBody {
  times?: Partial<Record<LiveBlockId, string>>;
  skippedBlocks?: LiveBlockId[];
  timezone?: string;
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

  // A stale cached frontend bundle (this repo has no backend auto-deploy, so the two aren't
  // guaranteed atomic) would still be sending the old block1/frequency shape — reject it clearly
  // rather than silently no-op-succeeding by destructuring fields that no longer exist.
  const legacyShape = body as unknown as { block1?: unknown; frequency?: unknown };
  if (legacyShape.block1 !== undefined || legacyShape.frequency !== undefined) {
    return errorResponse("Cadence format has changed — please refresh the app", 400);
  }
  if (body.times === undefined && body.skippedBlocks === undefined && body.timezone === undefined) {
    return errorResponse("Nothing to update", 400);
  }

  const state = await getState(env, userId);
  const next = { ...state.cadence, times: { ...state.cadence.times, ...body.times } };
  if (body.timezone) next.timezone = body.timezone;

  if (body.skippedBlocks !== undefined) {
    if (!Array.isArray(body.skippedBlocks) || !body.skippedBlocks.every((b) => isLiveBlockId(b))) {
      return errorResponse("skippedBlocks must be an array of q1, q2, q3, q4", 400);
    }
    if (body.skippedBlocks.length >= LIVE_BLOCKS.length) {
      return errorResponse("At least one check-in must stay on", 400);
    }
    next.skippedBlocks = body.skippedBlocks;
  }

  const activeTimes = LIVE_BLOCKS.filter((b) => !next.skippedBlocks.includes(b)).map((b) => next.times[b]);
  const err = checkInTimesError(activeTimes);
  if (err) return errorResponse(err, 400);

  state.cadence = next;
  await saveState(env, userId, state);
  await scheduleUserPush(env, userId);
  return json({ cadence: state.cadence });
}
