import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState } from "../state";
import { acceptRecommendation } from "../recommendations";

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
  timezone?: string;
}

export async function handleUpdateCadence(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<CadenceBody>(request);
  const state = await getState(env, userId);
  if (body.block1) state.cadence.block1 = body.block1;
  if (body.block2) state.cadence.block2 = body.block2;
  if (body.timezone) state.cadence.timezone = body.timezone;
  await saveState(env, userId, state);
  return json({ cadence: state.cadence });
}
