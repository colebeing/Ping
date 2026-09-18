import {
  LIVE_BLOCKS,
  isLiveBlockId,
  type Answer,
  type Category,
  type EscalationChildren,
  type EscalationNode,
  type EscalationPath,
  type EscalationStep,
  type FollowupPrompt,
  type LiveBlockId,
  type QuestionOverride,
  type QuestionRoot,
  type RecommendationNudge,
  type TriggerConfig,
  type UserState,
} from "./types";

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / msPerDay);
}

/** Global key for a declined streak — "<valence>:<category>" or "<valence>:general" for the
 * mixed-category slot. Not scoped by block: responses across all four blocks count toward the same
 * streak now (see detectStreaks), so a decline has to reset the same global count. */
function declinedStreakKey(valence: Answer, category: Category | null): string {
  return `${valence}:${category ?? "general"}`;
}

/** Walks the escalation tree from the root along `path`, step by step. `[]` means "the root" — callers
 * that need root's own children just use `root.children` directly instead of calling this with `[]`.
 * Returns null if any step along the way is missing — shouldn't happen for a real stored override
 * (every step it was built from once existed), but a defensive null beats a throw. */
export function resolveNode(root: QuestionRoot, path: EscalationPath): EscalationNode | null {
  let node: EscalationNode | null = null;
  let children: EscalationChildren = root.children;
  for (const step of path) {
    const next = step.category === null ? (step.valence === "yes" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
    if (!next) return null;
    node = next;
    children = next.children;
  }
  return node;
}

/**
 * An active override's content, resolved LIVE against the current tree rather than the frozen snapshot
 * taken at accept time — an admin editing that node's question/follow-up text (a very ordinary thing to
 * do, especially on a single-admin account where the admin and the user are the same person) should be
 * reflected wherever this question is shown, not just in Admin. Falls back to the override's own
 * denormalized snapshot only if the tree has since changed shape enough that `path` no longer resolves
 * (the node was deleted/restructured) — better than a broken question with nothing to show at all.
 */
export function resolveOverrideContent(
  root: QuestionRoot,
  override: QuestionOverride,
): { blockQuestions: Record<LiveBlockId, string>; yes: FollowupPrompt; no: FollowupPrompt } {
  const node = resolveNode(root, override.path);
  if (node) return { blockQuestions: node.blockQuestions, yes: node.yes, no: node.no };
  return { blockQuestions: override.blockQuestions, yes: override.yes, no: override.no };
}

function pathsEqual(a: EscalationPath, b: EscalationPath): boolean {
  if (a.length !== b.length) return false;
  return a.every((step, i) => step.valence === b[i].valence && step.category === b[i].category);
}

/**
 * Checks whether the response just recorded (`justAnswered`) has pushed a streak's total response count
 * to threshold, and if so proposes a recommendation. The yes valence covers yes-streaks (do more of
 * what's working), no covers no-streaks — symmetric per spec.
 *
 * Counts *responses*, not consecutive days, and globally across all four live blocks, not per block —
 * three blocks all answered "yes, family" on the same day count as 3 toward that streak, same as 3
 * spread across 3 separate days. Only the two counts this one response could have just moved (its own
 * exact category, and the general/mixed one) are checked — a call only ever evaluates one response, so
 * at most one recommendation is ever produced per call.
 *
 * If the count shares a single category throughout, that's the specific per-category invitation (8 of
 * the 10 slots). The general yes/no invitation (the remaining 2 slots) counts every response of that
 * valence regardless of category.
 *
 * The invitation itself is resolved against the account's CURRENT node in the escalation tree (root, or
 * wherever an already-accepted override has advanced to) — if that node has no child authored at this
 * (valence, category) slot, nothing is proposed at all. Escalation only ever goes as deep as an admin
 * has actually built it; there's no fallback to some default set.
 */
export function detectStreaks(
  state: UserState,
  thresholds: TriggerConfig,
  root: QuestionRoot,
  justAnswered: { block: LiveBlockId; answer: Answer; category: Category; timestamp: string },
): RecommendationNudge[] {
  const newRecs: RecommendationNudge[] = [];

  // One shared tree position for the whole account now (accepting a swap invite moves every block at
  // once).
  const currentPath = state.activeOverride?.path ?? [];
  const children = currentPath.length === 0 ? root.children : (resolveNode(root, currentPath)?.children ?? root.children);

  // A valence IS just which answer produced this streak direction — same Answer type, no translation.
  const valence: Answer = justAnswered.answer;

  // A decline's asOfTimestamp is a floor: responses at or before it don't count toward a fresh streak,
  // so a declined invitation needs genuinely new responses (not the same count continuing) before
  // anything is proposed again — whether that next proposal would be the same per-category invitation,
  // or the general one built from the same underlying responses reworded under different copy.
  const categoryFloor = state.declinedStreaks[declinedStreakKey(valence, justAnswered.category)]?.asOfTimestamp;
  const categoryCount = state.answers.filter(
    (a) =>
      isLiveBlockId(a.block) &&
      a.answer === justAnswered.answer &&
      a.category === justAnswered.category &&
      (!categoryFloor || a.timestamp > categoryFloor),
  ).length;

  const generalFloor = state.declinedStreaks[declinedStreakKey(valence, null)]?.asOfTimestamp;
  const generalCount = state.answers.filter(
    (a) => isLiveBlockId(a.block) && a.answer === justAnswered.answer && a.category && (!generalFloor || a.timestamp > generalFloor),
  ).length;

  const categoryThreshold = valence === "yes" ? thresholds.categoryYesThreshold : thresholds.categoryNoThreshold;
  const generalThreshold = valence === "yes" ? thresholds.generalYesThreshold : thresholds.generalNoThreshold;

  let runCategory: Category | null = null;
  let step: EscalationStep;
  if (categoryCount >= categoryThreshold) {
    runCategory = justAnswered.category;
    step = { valence, category: justAnswered.category };
  } else if (generalCount >= generalThreshold) {
    step = { valence, category: null };
  } else {
    return newRecs;
  }

  const child = step.category === null ? (step.valence === "yes" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
  if (!child) return newRecs; // nothing authored at this slot — no swap invite offered, no error

  const candidatePath = [...currentPath, step];

  // Dedup compares the FULL path, not just the trailing {valence, category} — two structurally
  // distinct nodes at different depths can share the same trailing step (e.g. a depth-1 node and
  // some depth-3 descendant that also happens to end in the same category/valence). Only an actually
  // still-open (pending) one counts here — a declined one is a resolved, historical fact, not something
  // sitting unresolved, so the same pattern recurring later (once the decline's own floor clears) is
  // free to propose a genuinely new invitation for the same path.
  const alreadyPending = state.recommendationHistory.some((n) => n.status === "pending" && pathsEqual(n.path, candidatePath));
  const alreadyActive = Boolean(state.activeOverride && pathsEqual(state.activeOverride.path, candidatePath));
  if (alreadyPending || alreadyActive) return newRecs;

  newRecs.push({
    id: crypto.randomUUID(),
    kind: "recommendation",
    status: "pending",
    block: justAnswered.block,
    path: candidatePath,
    node: { inviteQuestion: child.inviteQuestion, blockQuestions: child.blockQuestions, yes: child.yes, no: child.no, digIn: child.digIn },
    category: runCategory,
    valence,
    asOfTimestamp: justAnswered.timestamp,
    createdAt: new Date().toISOString(),
  });

  return newRecs;
}

export type AcceptOutcome = "ok" | "not-found" | "digin-choice-required" | "invalid-digin-choice";

/**
 * `digInChoice` is required (and must index a non-blank option) when the node being accepted has its
 * own `digIn` — see DigIn's doc comment. yes/no always come from the node itself regardless of which
 * digIn option (if any) was picked; only blockQuestions is superseded by the option's own.
 */
export function acceptRecommendation(state: UserState, recommendationId: string, digInChoice?: number): AcceptOutcome {
  const idx = state.recommendationHistory.findIndex((n) => n.id === recommendationId);
  if (idx === -1) return "not-found";
  const rec = state.recommendationHistory[idx];

  let blockQuestions = rec.node.blockQuestions;
  if (rec.node.digIn) {
    if (digInChoice === undefined) return "digin-choice-required";
    const option = rec.node.digIn.options[digInChoice];
    if (!option || !option.label) return "invalid-digin-choice";
    blockQuestions = option.blockQuestions;
  }

  // Never removed, whatever its prior status — accepting a long-declined (or still-pending) invite from
  // wherever it's shown is exactly the point of keeping this history around at all.
  rec.status = "accepted";
  state.activeOverride = {
    path: rec.path,
    blockQuestions,
    yes: rec.node.yes,
    no: rec.node.no,
    category: rec.category,
    digInChoice: rec.node.digIn ? digInChoice! : null,
    acceptedAt: new Date().toISOString(),
  };
  // A decline's meaning is tied to the tree position it was declined at, which just moved for the
  // whole account, not just the one block that produced this accepted invitation. Every OTHER
  // recommendation's own status is left exactly as it was — unlike the old pendingNudges-based
  // mechanic, nothing here goes stale just because the account's position moved; each one stays
  // exactly what it always was: a specific offer, on a specific answer, still open to being accepted
  // later regardless of what's currently active.
  state.declinedStreaks = {};
  return "ok";
}

/** The user said no — mark it declined (never removed) and remember the exact streak declined so
 * detectStreaks won't re-propose it while that same run continues. */
export function declineRecommendation(state: UserState, recommendationId: string): boolean {
  const rec = state.recommendationHistory.find((n) => n.id === recommendationId);
  if (!rec) return false;
  rec.status = "declined";
  state.declinedStreaks[declinedStreakKey(rec.valence, rec.category)] = { asOfTimestamp: rec.asOfTimestamp };
  return true;
}

/** Lazily retires a promoted question once its boundary has held for thresholds.retireAfterDays with
 * no "no" answer since acceptance — reverts fully to the root question, not "one level back": a
 * QuestionOverride only ever carries its own current path, not a stack of previously-accepted parent
 * nodes, so a user who advanced root -> A -> B has retiring B jump straight back to root, discarding
 * A's accepted state too. Same flat-reset behavior this always had; the tree just gives it a real (if
 * rare) way to lose more state than a single-level override ever could. */
export function checkRetirement(state: UserState, todayStr: string, thresholds: TriggerConfig): void {
  const override = state.activeOverride;
  if (!override) return;
  const acceptedDate = override.acceptedAt.slice(0, 10);
  if (daysBetween(acceptedDate, todayStr) < thresholds.retireAfterDays) return;

  // Held across the whole account now — a "no" on ANY of the four blocks means the swapped-in
  // question isn't landing, since all four ask their own variant of the same active node.
  const heldWithNoSetback = !state.answers.some(
    (a) => (LIVE_BLOCKS as string[]).includes(a.block) && a.date >= acceptedDate && a.answer === "no",
  );
  if (heldWithNoSetback) {
    state.retiredOverrides.push(override);
    state.activeOverride = undefined;
  }
}
