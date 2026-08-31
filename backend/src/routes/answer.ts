import { CATEGORIES, isBlockId, type Answer, type AnswerRecord, type BlockId, type Category, type Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState, resolveDate } from "../state";
import { getConfig, getTriggerConfig, getRecommendationCopy } from "../config";
import { decrementFollowupEvent, recordFollowupEvent } from "../escalation";
import { detectStreaks } from "../recommendations";

interface AnswerBody {
  block: BlockId;
  answer: Answer;
  date?: string;
}

export async function handleAnswer(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<AnswerBody>(request);
  // Diagnostic for the notification quick-answer bug: whatever's logged here
  // is exactly what the server received, decoupled from what the client
  // (service worker or app) believes it sent — compare against the SW's own
  // "[ping] posting quick-answer" log for the same tap.
  console.log("[ping] /api/answer received", { userId, block: body.block, answer: body.answer, date: body.date });
  if (!isBlockId(body.block) || (body.answer !== "yes" && body.answer !== "no")) {
    return errorResponse("block must be 1, 2, or combined, and answer must be 'yes' or 'no'", 400);
  }

  const state = await getState(env, userId);
  const date = resolveDate(state.cadence.timezone, body.date);

  const existingIdx = state.answers.findIndex((a) => a.date === date && a.block === body.block);
  if (existingIdx !== -1) {
    // Editing an existing answer (today or backfilling a past day): undo any prior follow-up count before overwriting.
    const prev = state.answers[existingIdx];
    if (prev.category) decrementFollowupEvent(state, prev.block, prev.answer, prev.category);
  }

  const record: AnswerRecord = { date, block: body.block, answer: body.answer, timestamp: new Date().toISOString() };
  console.log("[ping] /api/answer storing", record);
  if (existingIdx !== -1) state.answers[existingIdx] = record;
  else state.answers.push(record);

  await saveState(env, userId, state);

  const override = state.activeOverrides[body.block];
  const content = override ? override[body.answer] : (await getConfig(env)).blocks[body.block][body.answer];
  return json({ block: body.block, date, answer: body.answer, followup: { prompt: content.prompt, options: content.options } });
}

interface FollowupBody {
  block: BlockId;
  category: Category;
  date?: string;
}

export async function handleFollowup(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<FollowupBody>(request);
  if (!isBlockId(body.block)) {
    return errorResponse("block must be 1, 2, or combined", 400);
  }
  if (!CATEGORIES.includes(body.category)) {
    return errorResponse("invalid category", 400);
  }

  const state = await getState(env, userId);
  const date = resolveDate(state.cadence.timezone, body.date);
  const idx = state.answers.findIndex((a) => a.date === date && a.block === body.block);
  if (idx === -1) return errorResponse("Answer the block's yes/no question first", 409);

  const record = state.answers[idx];
  if (record.category) decrementFollowupEvent(state, record.block, record.answer, record.category);
  record.category = body.category;

  const [thresholds, copy] = await Promise.all([getTriggerConfig(env), getRecommendationCopy(env)]);
  const { triggers, primary } = recordFollowupEvent(state, record.block, record.answer, body.category, thresholds);

  const newRecs = detectStreaks(state, thresholds, copy);
  state.pendingRecommendations.push(...newRecs);

  await saveState(env, userId, state);

  return json({ triggers, primary, newRecommendations: newRecs, pendingRecommendations: state.pendingRecommendations });
}
