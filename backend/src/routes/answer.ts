import type { Answer, AnswerRecord, BlockId, Category, Env, FollowupVariant } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState, todayLocal } from "../state";
import { getConfig } from "../config";
import { decrementFollowupEvent, recordFollowupEvent } from "../escalation";
import { detectStreaks } from "../recommendations";

interface AnswerBody {
  block: BlockId;
  answer: Answer;
}

export async function handleAnswer(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<AnswerBody>(request);
  if ((body.block !== "1" && body.block !== "2") || (body.answer !== "yes" && body.answer !== "no")) {
    return errorResponse("block must be 1 or 2 and answer must be 'yes' or 'no'", 400);
  }

  const state = await getState(env, userId);
  const today = todayLocal(state.cadence.timezone);

  const existingIdx = state.answers.findIndex((a) => a.date === today && a.block === body.block);
  if (existingIdx !== -1) {
    // Editing today's answer: undo any prior follow-up counts before overwriting.
    const prev = state.answers[existingIdx];
    if (prev.what) decrementFollowupEvent(state, prev.block, prev.answer, "what", prev.what);
    if (prev.why) decrementFollowupEvent(state, prev.block, prev.answer, "why", prev.why);
  }

  const record: AnswerRecord = { date: today, block: body.block, answer: body.answer, timestamp: new Date().toISOString() };
  if (existingIdx !== -1) state.answers[existingIdx] = record;
  else state.answers.push(record);

  await saveState(env, userId, state);

  const config = await getConfig(env);
  const content = config.blocks[body.block][body.answer];
  return json({ block: body.block, answer: body.answer, followups: { what: content.what, why: content.why } });
}

interface FollowupBody {
  block: BlockId;
  variant: FollowupVariant;
  category: Category;
}

export async function handleFollowup(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<FollowupBody>(request);
  if ((body.block !== "1" && body.block !== "2") || (body.variant !== "what" && body.variant !== "why")) {
    return errorResponse("block must be 1 or 2 and variant must be 'what' or 'why'", 400);
  }
  if (!["friends", "work", "home", "capacity"].includes(body.category)) {
    return errorResponse("invalid category", 400);
  }

  const state = await getState(env, userId);
  const today = todayLocal(state.cadence.timezone);
  const idx = state.answers.findIndex((a) => a.date === today && a.block === body.block);
  if (idx === -1) return errorResponse("Answer the block's yes/no question first", 409);

  const record = state.answers[idx];
  const prevCategory = record[body.variant];
  if (prevCategory) decrementFollowupEvent(state, record.block, record.answer, body.variant, prevCategory);

  record[body.variant] = body.category;
  const { triggers, primary } = recordFollowupEvent(state, record.block, record.answer, body.variant, body.category);

  const newRecs = detectStreaks(state);
  state.pendingRecommendations.push(...newRecs);

  await saveState(env, userId, state);

  return json({ triggers, primary, newRecommendations: newRecs, pendingRecommendations: state.pendingRecommendations });
}
