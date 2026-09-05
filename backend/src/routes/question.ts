import { isBlockId, isLiveBlockId, type FollowupPrompt, type Env } from "../types";
import { errorResponse, json } from "../http";
import { getState, saveState, todayLocal, resolveDate } from "../state";
import { getConfig, getQuestionRoot, getTriggerConfig } from "../config";
import { checkRetirement } from "../recommendations";

export async function handleGetQuestion(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const block = url.searchParams.get("block");
  if (!isBlockId(block)) return errorResponse("block must be a valid block id", 400);

  const state = await getState(env, userId);
  const today = todayLocal(state.cadence.timezone);
  const date = resolveDate(state.cadence.timezone, url.searchParams.get("date"));

  // Override retirement is always evaluated against real "today", regardless of which date's card is being viewed.
  const before = JSON.stringify(state.activeOverrides);
  checkRetirement(state, today, await getTriggerConfig(env));
  if (JSON.stringify(state.activeOverrides) !== before) await saveState(env, userId, state);

  const override = state.activeOverrides[block];
  // Live blocks (q1-q4) source their base question/follow-up from the escalation tree; the 3 frozen
  // legacy blocks ("1"/"2"/"combined") still read from AppConfig, exactly as before this tree existed.
  let question: string;
  let yes: FollowupPrompt;
  let no: FollowupPrompt;
  if (isLiveBlockId(block)) {
    const root = await getQuestionRoot(env);
    question = override?.question ?? root.blockQuestions[block];
    yes = root.yes;
    no = root.no;
  } else {
    const config = await getConfig(env);
    question = override?.question ?? config.blocks[block].question;
    yes = config.blocks[block].yes;
    no = config.blocks[block].no;
  }

  // For a day that isn't actually today (History looking back), "today" in the question text is
  // ambiguous — say "the day" instead to disambiguate. Global replace: with no when/how boundary to
  // anchor which "today" is meant, a complete question can plausibly contain the word more than once.
  const text = date === today ? question : question.replace(/\btoday\b/g, "the day");

  const existingAnswer = state.answers.find((a) => a.date === date && a.block === block);
  let followup: { prompt: string; optionLabel: string } | undefined;
  if (existingAnswer?.category) {
    const content = override ? override[existingAnswer.answer] : existingAnswer.answer === "yes" ? yes : no;
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
    text,
    overridden: Boolean(override),
    existingAnswer: existingAnswer ? { ...existingAnswer, followup } : null,
    pendingRecommendation,
  });
}
