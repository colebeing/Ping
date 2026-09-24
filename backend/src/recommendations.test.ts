import { describe, expect, it } from "vitest";
import {
  acceptRecommendation,
  checkUnanswered,
  declineRecommendation,
  derefNode,
  detectStreaks,
  isUnfinishedNode,
  pendingReturnInvite,
  resolveNode,
  resolveOverrideContent,
  RETURN_TO_ROUTINE_INVITE,
} from "./recommendations";
import { defaultState } from "./state";
import { makeNode } from "./test/helpers";
import type { AnswerRecord, QuestionRoot, RecommendationNudge, TriggerConfig, UserState } from "./types";

const THRESHOLDS: TriggerConfig = {
  categoryYesThreshold: 3,
  categoryNoThreshold: 3,
  generalYesThreshold: 3,
  generalNoThreshold: 3,
  returnAfterUnansweredDays: 3,
};

function rootWith(children: Partial<QuestionRoot["children"]> = {}): QuestionRoot {
  return {
    blockQuestions: { q1: "root q1", q2: "root q2", q3: "root q3", q4: "root q4" },
    yes: { prompt: "root yes", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
    no: { prompt: "root no", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
    children: { yes: {}, no: {}, ...children },
  };
}

function answer(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
  return { date: "2024-01-01", block: "q1", answer: "yes", category: "people", timestamp: "2024-01-01T08:00:00.000Z", ...overrides };
}

describe("resolveNode / derefNode", () => {
  it("resolves a one-level path to the node authored at that slot", () => {
    const target = makeNode({ label: "people-yes" });
    const root = rootWith({ yes: { people: target } });
    expect(resolveNode(root, [{ valence: "yes", category: "people" }])).toEqual(target);
  });

  it("resolves a general (category: null) slot", () => {
    const target = makeNode({ label: "general-yes" });
    const root = rootWith({ generalYes: target });
    expect(resolveNode(root, [{ valence: "yes", category: null }])).toEqual(target);
  });

  it("resolves multi-level paths by walking each step's own children", () => {
    const deep = makeNode({ label: "deep" });
    const mid = makeNode({ label: "mid", children: { yes: { impact: deep }, no: {} } });
    const root = rootWith({ no: { environment: mid } });
    const path = [
      { valence: "no" as const, category: "environment" as const },
      { valence: "yes" as const, category: "impact" as const },
    ];
    expect(resolveNode(root, path)).toEqual(deep);
  });

  it("returns null when a step in the path was never authored", () => {
    const root = rootWith();
    expect(resolveNode(root, [{ valence: "yes", category: "people" }])).toBeNull();
  });

  it("follows a ref transparently to the real node's own content and children", () => {
    const real = makeNode({ label: "real", children: { yes: { people: makeNode({ label: "real-child" }) }, no: {} } });
    const refShell = makeNode({ label: "shell", ref: [{ valence: "no", category: "capacity" }] });
    const root = rootWith({ yes: { people: refShell }, no: { capacity: real } });
    const resolved = resolveNode(root, [{ valence: "yes", category: "people" }]);
    expect(resolved).toEqual(real);
    // Escalating one step further from the ref slot must use the REAL node's children, not the shell's.
    const deeper = resolveNode(root, [
      { valence: "yes", category: "people" },
      { valence: "yes", category: "people" },
    ]);
    expect(deeper?.label).toBe("real-child");
  });

  it("derefNode resolves a broken/cyclic ref chain to null rather than looping forever", () => {
    const cyclic = makeNode({ label: "cyclic", ref: [{ valence: "yes", category: "people" }] });
    const root = rootWith({ yes: { people: cyclic } });
    expect(derefNode(root, cyclic)).toBeNull();
  });
});

describe("resolveOverrideContent", () => {
  it("resolves LIVE against the current tree, not the override's own frozen snapshot", () => {
    const editedNode = makeNode({ label: "edited-live" });
    const root = rootWith({ yes: { people: editedNode } });
    const override = {
      path: [{ valence: "yes" as const, category: "people" as const }],
      blockQuestions: { q1: "stale snapshot", q2: "stale", q3: "stale", q4: "stale" },
      yes: editedNode.yes,
      no: editedNode.no,
      category: "people" as const,
      digInChoice: null,
      acceptedAt: "2024-01-01",
    };
    const content = resolveOverrideContent(root, override);
    expect(content.blockQuestions.q1).toBe(editedNode.blockQuestions.q1);
    expect(content.blockQuestions.q1).not.toBe("stale snapshot");
  });

  it("falls back to the override's own denormalized snapshot when its path no longer resolves", () => {
    const root = rootWith(); // the node this override pointed to has since been deleted/restructured
    const override = {
      path: [{ valence: "yes" as const, category: "people" as const }],
      blockQuestions: { q1: "snapshot text", q2: "s", q3: "s", q4: "s" },
      yes: { prompt: "snap yes", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
      no: { prompt: "snap no", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
      category: "people" as const,
      digInChoice: null,
      acceptedAt: "2024-01-01",
    };
    const content = resolveOverrideContent(root, override);
    expect(content.blockQuestions.q1).toBe("snapshot text");
  });
});

describe("isUnfinishedNode", () => {
  it("is unfinished when inviteQuestion is blank", () => {
    expect(isUnfinishedNode(makeNode({ inviteQuestion: "  " }))).toBe(true);
  });
  it("is unfinished when the Morning (q1) question is blank", () => {
    const node = makeNode();
    node.blockQuestions.q1 = "";
    expect(isUnfinishedNode(node)).toBe(true);
  });
  it("is finished once both are set", () => {
    expect(isUnfinishedNode(makeNode())).toBe(false);
  });
});

describe("detectStreaks", () => {
  function stateWithAnswers(answers: AnswerRecord[]): UserState {
    return { ...defaultState(), answers };
  }

  it("proposes nothing below threshold", () => {
    const root = rootWith({ yes: { people: makeNode() } });
    const answers = [answer({ timestamp: "t1" }), answer({ timestamp: "t2" })]; // only 2, threshold is 3
    const state = stateWithAnswers(answers);
    const recs = detectStreaks(state, THRESHOLDS, root, { block: "q1", answer: "yes", category: "people", timestamp: "t2" });
    expect(recs).toHaveLength(0);
  });

  it("proposes the per-category invitation once the category streak hits threshold", () => {
    const child = makeNode({ label: "people-swap" });
    const root = rootWith({ yes: { people: child } });
    const answers = [answer({ timestamp: "t1" }), answer({ timestamp: "t2" }), answer({ timestamp: "t3" })];
    const state = stateWithAnswers(answers);
    const recs = detectStreaks(state, THRESHOLDS, root, { block: "q1", answer: "yes", category: "people", timestamp: "t3" });
    expect(recs).toHaveLength(1);
    expect(recs[0].path).toEqual([{ valence: "yes", category: "people" }]);
    expect(recs[0].node.inviteQuestion).toBe(child.inviteQuestion);
  });

  it("proposes nothing when the threshold slot was never authored", () => {
    const root = rootWith(); // no yes.people child authored
    const answers = [answer({ timestamp: "t1" }), answer({ timestamp: "t2" }), answer({ timestamp: "t3" })];
    const state = stateWithAnswers(answers);
    const recs = detectStreaks(state, THRESHOLDS, root, { block: "q1", answer: "yes", category: "people", timestamp: "t3" });
    expect(recs).toHaveLength(0);
  });

  it("falls back to the general invitation once a mixed-category streak hits its own threshold", () => {
    const generalChild = makeNode({ label: "general-swap" });
    const root = rootWith({ generalYes: generalChild });
    // 3 total yes/category answers, but no single category repeats 3x — only the general count clears.
    const answers = [
      answer({ timestamp: "t1", category: "environment" }),
      answer({ timestamp: "t2", category: "impact" }),
      answer({ timestamp: "t3", category: "capacity" }),
    ];
    const state = stateWithAnswers(answers);
    const recs = detectStreaks(state, THRESHOLDS, root, { block: "q1", answer: "yes", category: "capacity", timestamp: "t3" });
    expect(recs).toHaveLength(1);
    expect(recs[0].path).toEqual([{ valence: "yes", category: null }]);
  });

  it("does not re-propose a path that's already pending", () => {
    const child = makeNode({ label: "people-swap" });
    const root = rootWith({ yes: { people: child } });
    const answers = [answer({ timestamp: "t1" }), answer({ timestamp: "t2" }), answer({ timestamp: "t3" })];
    const pending: RecommendationNudge = {
      id: "existing",
      kind: "recommendation",
      status: "pending",
      block: "q1",
      path: [{ valence: "yes", category: "people" }],
      node: { inviteQuestion: child.inviteQuestion, blockQuestions: child.blockQuestions, yes: child.yes, no: child.no },
      category: "people",
      valence: "yes",
      asOfTimestamp: "t0",
      createdAt: "2024-01-01",
    };
    const state = { ...stateWithAnswers(answers), recommendationHistory: [pending] };
    const recs = detectStreaks(state, THRESHOLDS, root, { block: "q1", answer: "yes", category: "people", timestamp: "t3" });
    expect(recs).toHaveLength(0);
  });

  it("ignores responses at or before a declined streak's floor when recounting", () => {
    const child = makeNode({ label: "people-swap" });
    const root = rootWith({ yes: { people: child } });
    // Only t3 is strictly after the decline floor (t2) — t1/t2 don't count toward a fresh streak.
    const answers = [answer({ timestamp: "t1" }), answer({ timestamp: "t2" }), answer({ timestamp: "t3" })];
    const state: UserState = { ...stateWithAnswers(answers), declinedStreaks: { "yes:people": { asOfTimestamp: "t2" } } };
    const recs = detectStreaks(state, THRESHOLDS, root, { block: "q1", answer: "yes", category: "people", timestamp: "t3" });
    expect(recs).toHaveLength(0);
  });
});

describe("acceptRecommendation / declineRecommendation", () => {
  function pendingRec(overrides: Partial<RecommendationNudge> = {}): RecommendationNudge {
    return {
      id: "rec-1",
      kind: "recommendation",
      status: "pending",
      block: "q1",
      path: [{ valence: "yes", category: "people" }],
      node: { inviteQuestion: "Switch?", blockQuestions: { q1: "a", q2: "b", q3: "c", q4: "d" }, yes: { prompt: "y", options: { environment: "e", people: "p", impact: "i", capacity: "c" } }, no: { prompt: "n", options: { environment: "e", people: "p", impact: "i", capacity: "c" } } },
      category: "people",
      valence: "yes",
      asOfTimestamp: "t0",
      createdAt: "2024-01-01",
      ...overrides,
    };
  }

  it("accepting sets activeOverride from the recommendation's own node and marks it accepted", () => {
    const rec = pendingRec();
    const state: UserState = { ...defaultState(), recommendationHistory: [rec], declinedStreaks: { "no:impact": { asOfTimestamp: "t9" } } };
    const outcome = acceptRecommendation(state, "rec-1");
    expect(outcome).toBe("ok");
    expect(state.recommendationHistory[0].status).toBe("accepted");
    expect(state.activeOverride?.path).toEqual(rec.path);
    expect(state.activeOverride?.blockQuestions).toEqual(rec.node.blockQuestions);
    // Accepting moves the account's whole tree position, so every prior decline's context is stale.
    expect(state.declinedStreaks).toEqual({});
  });

  it("returns not-found for an unknown recommendation id", () => {
    const state = defaultState();
    expect(acceptRecommendation(state, "missing")).toBe("not-found");
  });

  it("requires a digIn choice when the node has one, and rejects a blank/out-of-range option", () => {
    const digInNode = pendingRec({
      node: {
        inviteQuestion: "Switch?",
        blockQuestions: { q1: "a", q2: "b", q3: "c", q4: "d" },
        yes: { prompt: "y", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
        no: { prompt: "n", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
        digIn: {
          prompt: "Which one?",
          options: [
            { label: "Alex", blockQuestions: { q1: "a1", q2: "a2", q3: "a3", q4: "a4" } },
            { label: "", blockQuestions: { q1: "", q2: "", q3: "", q4: "" } },
            { label: "", blockQuestions: { q1: "", q2: "", q3: "", q4: "" } },
            { label: "", blockQuestions: { q1: "", q2: "", q3: "", q4: "" } },
          ],
        },
      },
    });
    const state: UserState = { ...defaultState(), recommendationHistory: [digInNode] };
    expect(acceptRecommendation(state, "rec-1")).toBe("digin-choice-required");
    expect(acceptRecommendation(state, "rec-1", 1)).toBe("invalid-digin-choice"); // blank label
    const outcome = acceptRecommendation(state, "rec-1", 0);
    expect(outcome).toBe("ok");
    expect(state.activeOverride?.blockQuestions.q1).toBe("a1");
  });

  it("declining marks the recommendation declined and records the streak's decline floor", () => {
    const rec = pendingRec();
    const state: UserState = { ...defaultState(), recommendationHistory: [rec] };
    expect(declineRecommendation(state, "rec-1")).toBe(true);
    expect(state.recommendationHistory[0].status).toBe("declined");
    expect(state.declinedStreaks["yes:people"]?.asOfTimestamp).toBe("t0");
  });

  it("declining an unknown id returns false and touches nothing", () => {
    const state = defaultState();
    expect(declineRecommendation(state, "missing")).toBe(false);
  });
});

describe("checkUnanswered / pendingReturnInvite", () => {
  function accepted(overrides: Partial<UserState["activeOverride"]> = {}): NonNullable<UserState["activeOverride"]> {
    return {
      path: [{ valence: "yes", category: "people" }],
      blockQuestions: { q1: "a", q2: "b", q3: "c", q4: "d" },
      yes: { prompt: "y", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
      no: { prompt: "n", options: { environment: "e", people: "p", impact: "i", capacity: "c" } },
      category: "people",
      digInChoice: null,
      acceptedAt: "2024-01-01",
      ...overrides,
    };
  }

  it("does nothing when no override is active", () => {
    const state = defaultState();
    expect(checkUnanswered(state, rootWith(), THRESHOLDS, new Date("2024-02-01"))).toBeNull();
    expect(state.recommendationHistory).toHaveLength(0);
  });

  it("does nothing before returnAfterUnansweredDays has elapsed", () => {
    const state: UserState = { ...defaultState(), activeOverride: accepted() };
    // only 2 full days since acceptedAt, threshold is 3
    expect(checkUnanswered(state, rootWith(), THRESHOLDS, new Date("2024-01-03"))).toBeNull();
    expect(pendingReturnInvite(state)).toBeUndefined();
  });

  it("offers a step-back invite once the threshold holds with no answers at all", () => {
    const state: UserState = { ...defaultState(), activeOverride: accepted() };
    // exactly 4 full days since acceptedAt, no answers at all
    const invite = checkUnanswered(state, rootWith(), THRESHOLDS, new Date("2024-01-05"));
    expect(invite).not.toBeNull();
    expect(invite?.trigger).toBe("unanswered");
    expect(invite?.status).toBe("pending");
    // The override's own path is a single step, so its parent is the root itself.
    expect(invite?.node.inviteQuestion).toBe(RETURN_TO_ROUTINE_INVITE);
    expect(pendingReturnInvite(state)).toEqual(invite);
  });

  it("offers the parent node's own invite when stepping back to a real authored node, not the root", () => {
    const parent = makeNode({ label: "parent" });
    const root = rootWith({ yes: { people: parent } });
    const deepPath = [
      { valence: "yes" as const, category: "people" as const },
      { valence: "yes" as const, category: "impact" as const },
    ];
    const state: UserState = { ...defaultState(), activeOverride: accepted({ path: deepPath }) };
    const invite = checkUnanswered(state, root, THRESHOLDS, new Date("2024-01-05"));
    expect(invite?.node.inviteQuestion).toBe(parent.inviteQuestion);
    expect(invite?.path).toEqual([{ valence: "yes", category: "people" }]);
  });

  it("does not trigger if any live-block answer was given since acceptance — the clock restarts from it", () => {
    const state: UserState = {
      ...defaultState(),
      activeOverride: accepted(),
      answers: [answer({ date: "2024-01-03", block: "q2", answer: "no", category: "impact", timestamp: "2024-01-03T08:00:00.000Z" })],
    };
    // 2 days since that answer (not 4 days since acceptedAt) — still under threshold
    expect(checkUnanswered(state, rootWith(), THRESHOLDS, new Date("2024-01-05"))).toBeNull();
  });

  it("never re-offers while a step-back invite is already pending", () => {
    const state: UserState = { ...defaultState(), activeOverride: accepted() };
    const first = checkUnanswered(state, rootWith(), THRESHOLDS, new Date("2024-01-05"));
    expect(first).not.toBeNull();
    expect(checkUnanswered(state, rootWith(), THRESHOLDS, new Date("2024-01-10"))).toBeNull();
    expect(state.recommendationHistory).toHaveLength(1);
  });
});
