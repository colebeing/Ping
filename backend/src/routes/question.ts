import type { BlockId, Env } from "../types";
import { errorResponse, json } from "../http";
import { getState, saveState, todayLocal, resolveDate } from "../state";
import { getConfig, getTriggerConfig } from "../config";
import { checkRetirement } from "../recommendations";

export async function handleGetQuestion(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const block = url.searchParams.get("block");
  if (block !== "1" && block !== "2") return errorResponse("block must be 1 or 2", 400);

  const state = await getState(env, userId);
  const today = todayLocal(state.cadence.timezone);
  const date = resolveDate(state.cadence.timezone, url.searchParams.get("date"));

  // Override retirement is always evaluated against real "today", regardless of which date's card is being viewed.
  const before = JSON.stringify(state.activeOverrides);
  checkRetirement(state, today, await getTriggerConfig(env));
  if (JSON.stringify(state.activeOverrides) !== before) await saveState(env, userId, state);

  const config = await getConfig(env);
  const override = state.activeOverrides[block as BlockId];
  const when = override?.when ?? config.blocks[block as BlockId].question.when;
  const how = override?.how ?? config.blocks[block as BlockId].question.how;

  const existingAnswer = state.answers.find((a) => a.date === date && a.block === block);

  return json({
    block,
    date,
    when,
    how,
    text: `Did ${when} ${how}?`,
    overridden: Boolean(override),
    existingAnswer: existingAnswer ?? null,
  });
}
