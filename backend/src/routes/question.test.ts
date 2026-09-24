import { describe, expect, it } from "vitest";
import { defaultState } from "../state";
import { FakeKV, makeNode } from "../test/helpers";
import type { AnswerRecord, Env, QuestionRoot, UserState } from "../types";
import { handleGetQuestion } from "./question";

/**
 * Regression coverage for the History bug: handleGetQuestion used to resolve question text from the
 * account's CURRENT activeOverride regardless of which date was requested, so accepting a swap
 * invitation retroactively rewrote what every day in History displayed — including days answered
 * before that override ever existed. It's now resolved from each answer's own recorded `path`.
 */

const ROOT_TEXT = "root question text";
const SWAP_TEXT = "swap question text";

function buildRoot(): QuestionRoot {
  const swapNode = makeNode({ label: "swap" });
  swapNode.blockQuestions.q1 = SWAP_TEXT;
  return {
    blockQuestions: { q1: ROOT_TEXT, q2: ROOT_TEXT, q3: ROOT_TEXT, q4: ROOT_TEXT },
    yes: { prompt: "root yes", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
    no: { prompt: "root no", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
    children: { yes: { people: swapNode }, no: {} },
  };
}

function buildEnv(state: UserState, root: QuestionRoot): { env: Env; configKV: FakeKV } {
  const configKV = new FakeKV();
  configKV.seed("config:question-root", root);
  // checkUnanswered runs against the real wall-clock date on every request — a huge
  // returnAfterUnansweredDays keeps it from offering a step-back invite out from under a fixture whose
  // acceptedAt is a fixed past date, which isn't what these tests are about.
  configKV.seed("config:triggers", { categoryYesThreshold: 3, categoryNoThreshold: 3, generalYesThreshold: 3, generalNoThreshold: 3, returnAfterUnansweredDays: 999999 });
  const stateKV = new FakeKV();
  stateKV.seed("state:user-1", state);
  return { env: { CONFIG_KV: configKV, STATE_KV: stateKV } as unknown as Env, configKV };
}

async function getText(env: Env, date: string): Promise<string> {
  const request = new Request(`http://test/api/question?block=q1&date=${date}`);
  const res = await handleGetQuestion(request, env, "user-1");
  const body = (await res.json()) as { text: string };
  return body.text;
}

describe("handleGetQuestion — historical question text", () => {
  const swapPath = [{ valence: "yes" as const, category: "people" as const }];

  function answeredState(answers: AnswerRecord[]): UserState {
    return {
      ...defaultState(),
      answers,
      activeOverride: {
        path: swapPath,
        blockQuestions: { q1: SWAP_TEXT, q2: SWAP_TEXT, q3: SWAP_TEXT, q4: SWAP_TEXT },
        yes: { prompt: "swap yes", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
        no: { prompt: "swap no", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
        category: "people",
        digInChoice: null,
        acceptedAt: "2024-01-04",
      },
    };
  }

  it("shows the ROOT question for a day answered before the swap, even though a swap is now active", async () => {
    const answers: AnswerRecord[] = [
      { date: "2024-01-01", block: "q1", answer: "yes", category: "people", path: [], timestamp: "2024-01-01T08:00:00.000Z" },
    ];
    const { env } = buildEnv(answeredState(answers), buildRoot());
    expect(await getText(env, "2024-01-01")).toBe(ROOT_TEXT);
  });

  it("shows the SWAP question for a day answered after the swap, resolved from that answer's own path", async () => {
    const answers: AnswerRecord[] = [
      { date: "2024-01-05", block: "q1", answer: "yes", category: "people", path: swapPath, timestamp: "2024-01-05T08:00:00.000Z" },
    ];
    const { env } = buildEnv(answeredState(answers), buildRoot());
    expect(await getText(env, "2024-01-05")).toBe(SWAP_TEXT);
  });

  it("falls back to the account's current override for a day with no answer yet", async () => {
    const { env } = buildEnv(answeredState([]), buildRoot());
    expect(await getText(env, "2024-01-10")).toBe(SWAP_TEXT);
  });

  it("treats a pre-tracking answer with no `path` field as the root question, not the current override", async () => {
    const answers: AnswerRecord[] = [
      // No `path` at all — predates the field. Per AnswerRecord.path's own contract this must read as [].
      { date: "2023-12-01", block: "q1", answer: "yes", category: "people", timestamp: "2023-12-01T08:00:00.000Z" },
    ];
    const { env } = buildEnv(answeredState(answers), buildRoot());
    expect(await getText(env, "2023-12-01")).toBe(ROOT_TEXT);
  });

  it("falls back to the ROOT question if an answer's path points at a node that no longer resolves", async () => {
    const deletedPath = [{ valence: "yes" as const, category: "capacity" as const }]; // never authored in buildRoot()
    const answers: AnswerRecord[] = [
      { date: "2024-01-02", block: "q1", answer: "yes", category: "capacity", path: deletedPath, timestamp: "2024-01-02T08:00:00.000Z" },
    ];
    const { env } = buildEnv(answeredState(answers), buildRoot());
    expect(await getText(env, "2024-01-02")).toBe(ROOT_TEXT);
  });

  it("with no override ever active, both an answered day and an unanswered day show the root question", async () => {
    const answers: AnswerRecord[] = [
      { date: "2024-01-01", block: "q1", answer: "no", category: "impact", path: [], timestamp: "2024-01-01T08:00:00.000Z" },
    ];
    const state: UserState = { ...defaultState(), answers };
    const { env } = buildEnv(state, buildRoot());
    expect(await getText(env, "2024-01-01")).toBe(ROOT_TEXT);
    expect(await getText(env, "2024-01-02")).toBe(ROOT_TEXT);
  });
});
