import type { Env } from "../types";
import { json } from "../http";
import { getState } from "../state";

const HISTORY_LIMIT = 60;

export async function handleGetHistory(_request: Request, env: Env, userId: string): Promise<Response> {
  const state = await getState(env, userId);
  const answers = [...state.answers].sort((a, b) => b.date.localeCompare(a.date)).slice(0, HISTORY_LIMIT);
  return json({ answers, cadence: state.cadence });
}
