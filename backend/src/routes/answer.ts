import { CATEGORIES, isLiveBlockId, type Answer, type AnswerRecord, type BlockId, type Category, type Env, type Nudge, type UserRecord, type UserState } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getState, saveState, resolveDate, hasPushEnabled } from "../state";
import { getQuestionRoot, getTriggerConfig } from "../config";
import { decrementFollowupEvent, recordFollowupEvent } from "../escalation";
import { detectStreaks } from "../recommendations";
import { getUser } from "../auth";

/**
 * Checkpoint-triggered nudges — a global follow-up-count table, deliberately a different shape from
 * detectStreaks above: streak detection iterates blocks and builds per-block invitation content, a
 * simple gate can't express that, so it stays its own function. These fire at most once each (a
 * monotonic counter only ever equals a given checkpoint once), and only when nothing else Home-level
 * is already pending — see runCheckpointTriggers below.
 */
const CHECKPOINT_TRIGGERS: { kind: "notification-permission" | "save-account"; checkpoint: number; condition: (state: UserState, user: UserRecord | null) => boolean }[] = [
  { kind: "notification-permission", checkpoint: 1, condition: (s) => !hasPushEnabled(s) },
  { kind: "notification-permission", checkpoint: 3, condition: (s) => !hasPushEnabled(s) },
  { kind: "notification-permission", checkpoint: 10, condition: (s) => !hasPushEnabled(s) },
  { kind: "save-account", checkpoint: 8, condition: (s, u) => hasPushEnabled(s) && !u?.email },
];

function runCheckpointTriggers(state: UserState, user: UserRecord | null): void {
  const hasHomeLevelPending = state.pendingNudges.some((n) => n.kind !== "recommendation");
  if (hasHomeLevelPending) return;
  const trigger = CHECKPOINT_TRIGGERS.find((t) => t.checkpoint === state.totalFollowupsAnswered && t.condition(state, user));
  if (!trigger) return;
  const nudge: Nudge = { id: crypto.randomUUID(), kind: trigger.kind, checkpoint: trigger.checkpoint, createdAt: new Date().toISOString() };
  state.pendingNudges.push(nudge);
}

interface AnswerBody {
  block: BlockId;
  answer: Answer;
  date?: string;
}

export async function handleAnswer(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<AnswerBody>(request);
  if (!isLiveBlockId(body.block) || (body.answer !== "yes" && body.answer !== "no")) {
    return errorResponse("block must be q1, q2, q3, or q4, and answer must be 'yes' or 'no'", 400);
  }

  const state = await getState(env, userId);
  const date = resolveDate(state.cadence.timezone, body.date);

  const existingIdx = state.answers.findIndex((a) => a.date === date && a.block === body.block);
  if (existingIdx !== -1) {
    // Editing an existing answer (today or backfilling a past day): undo any prior follow-up count before overwriting.
    const prev = state.answers[existingIdx];
    if (prev.category) decrementFollowupEvent(state, prev.block, prev.answer, prev.category);
    // Only a genuine change is an edit — resuming an in-progress card
    // (blockCard's "resume" step) re-posts this same answer as a safe
    // no-op, which shouldn't read as the user having changed their mind.
    if (prev.answer !== body.answer) {
      state.answerEdits.push({ date, block: body.block, previousAnswer: prev.answer, previousCategory: prev.category, editedAt: new Date().toISOString() });
    }
  }

  const record: AnswerRecord = { date, block: body.block, answer: body.answer, timestamp: new Date().toISOString() };
  if (existingIdx !== -1) state.answers[existingIdx] = record;
  else state.answers.push(record);

  await saveState(env, userId, state);

  const override = state.activeOverride;
  // body.block is always live here (isLiveBlockId-gated above) — its un-overridden follow-up is
  // always the escalation tree's one shared root.yes/root.no, never AppConfig (legacy-only now).
  const content = override ? override[body.answer] : (await getQuestionRoot(env))[body.answer];
  return json({ block: body.block, date, answer: body.answer, followup: { prompt: content.prompt, options: content.options } });
}

interface FollowupBody {
  block: BlockId;
  category: Category;
  date?: string;
}

export async function handleFollowup(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<FollowupBody>(request);
  if (!isLiveBlockId(body.block)) {
    return errorResponse("block must be q1, q2, q3, or q4", 400);
  }
  if (!CATEGORIES.includes(body.category)) {
    return errorResponse("invalid category", 400);
  }

  const state = await getState(env, userId);
  const date = resolveDate(state.cadence.timezone, body.date);
  const idx = state.answers.findIndex((a) => a.date === date && a.block === body.block);
  if (idx === -1) return errorResponse("Answer the block's yes/no question first", 409);

  const record = state.answers[idx];
  if (record.category) {
    decrementFollowupEvent(state, record.block, record.answer, record.category);
    if (record.category !== body.category) {
      state.answerEdits.push({ date, block: body.block, previousAnswer: record.answer, previousCategory: record.category, editedAt: new Date().toISOString() });
    }
  }
  record.category = body.category;
  // Lifetime, never decremented on edit — see UserState.totalFollowupsAnswered's doc comment for why
  // this can't be derived from answers.filter(a => a.category).length instead.
  state.totalFollowupsAnswered++;

  const [thresholds, root, user] = await Promise.all([getTriggerConfig(env), getQuestionRoot(env), getUser(env, userId)]);
  const { triggers, primary } = recordFollowupEvent(state, record.block, record.answer, body.category, thresholds);

  const newRecs = detectStreaks(state, thresholds, root);
  state.pendingNudges.push(...newRecs);
  runCheckpointTriggers(state, user);

  await saveState(env, userId, state);

  return json({
    triggers,
    primary,
    newRecommendations: newRecs,
    pendingRecommendations: state.pendingNudges.filter((n) => n.kind === "recommendation"),
  });
}
