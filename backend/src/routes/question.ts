import { isBlockId, type Env } from "../types";
import { errorResponse, json } from "../http";
import { getState, saveState, todayLocal, resolveDate } from "../state";
import { getConfig, getTriggerConfig } from "../config";
import { checkRetirement } from "../recommendations";

export async function handleGetQuestion(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const block = url.searchParams.get("block");
  if (!isBlockId(block)) return errorResponse("block must be 1, 2, or combined", 400);

  const state = await getState(env, userId);
  const today = todayLocal(state.cadence.timezone);
  const date = resolveDate(state.cadence.timezone, url.searchParams.get("date"));

  // Override retirement is always evaluated against real "today", regardless of which date's card is being viewed.
  const before = JSON.stringify(state.activeOverrides);
  checkRetirement(state, today, await getTriggerConfig(env));
  if (JSON.stringify(state.activeOverrides) !== before) await saveState(env, userId, state);

  const config = await getConfig(env);
  const override = state.activeOverrides[block];
  const when = override?.when ?? config.blocks[block].question.when;
  const how = override?.how ?? config.blocks[block].question.how;
  // For a day that isn't actually today (History looking back), "today" in
  // the question text is ambiguous — say "the day" instead to disambiguate.
  const whenText = date === today ? when : when.replace(/\btoday\b/, "the day");

  const existingAnswer = state.answers.find((a) => a.date === date && a.block === block);
  let followup: { prompt: string; optionLabel: string } | undefined;
  if (existingAnswer?.category) {
    const content = override ? override[existingAnswer.answer] : config.blocks[block][existingAnswer.answer];
    followup = { prompt: content.prompt, optionLabel: content.options[existingAnswer.category] };
  }

  // Only surfaced for today's own card — a pending invitation is a "just
  // happened" moment, not something that should resurface while browsing
  // History. Lets the client recover it after a reload, since it otherwise
  // only shows up transiently right after the followup call that created it.
  const pendingRecommendation =
    date === today ? (state.pendingNudges.find((n) => n.kind === "recommendation" && n.block === block) ?? null) : null;

  return json({
    block,
    date,
    when,
    how,
    text: `Did ${whenText} ${how}?`,
    overridden: Boolean(override),
    existingAnswer: existingAnswer ? { ...existingAnswer, followup } : null,
    pendingRecommendation,
  });
}
