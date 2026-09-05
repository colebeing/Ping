import {
  LIVE_BLOCKS,
  type Category,
  type EscalationChildren,
  type EscalationNode,
  type EscalationPath,
  type EscalationStep,
  type QuestionRoot,
  type RecommendationNudge,
  type TriggerConfig,
  type UserState,
} from "./types";

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / msPerDay);
}

function isPrevCalendarDay(earlier: string, later: string): boolean {
  return daysBetween(earlier, later) === 1;
}

/** Walks the escalation tree from the root along `path`, step by step. `[]` means "the root" — callers
 * that need root's own children just use `root.children` directly instead of calling this with `[]`.
 * Returns null if any step along the way is missing — shouldn't happen for a real stored override
 * (every step it was built from once existed), but a defensive null beats a throw. */
function resolveNode(root: QuestionRoot, path: EscalationPath): EscalationNode | null {
  let node: EscalationNode | null = null;
  let children: EscalationChildren = root.children;
  for (const step of path) {
    const next = step.category === null ? (step.valence === "amplify" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
    if (!next) return null;
    node = next;
    children = next.children;
  }
  return node;
}

function pathsEqual(a: EscalationPath, b: EscalationPath): boolean {
  if (a.length !== b.length) return false;
  return a.every((step, i) => step.valence === b[i].valence && step.category === b[i].category);
}

/**
 * Looks for a trailing run (most recent N consecutive days, same block, same
 * yes/no valence) and proposes a recommendation. Amplify for yes-streaks (do
 * more of what's working), resolve for no-streaks — symmetric per spec.
 *
 * If the run also shares a single category throughout, that's the specific
 * per-category invitation (8 of the 10 slots). If the valence-only run holds
 * but the category varies day to day, it's a "no underlying pattern" streak
 * — the general yes/no invitation (the remaining 2 slots).
 *
 * The invitation itself is resolved against the block's CURRENT node in the escalation tree (root, or
 * wherever an already-accepted override has advanced to) — if that node has no child authored at this
 * (valence, category) slot, nothing is proposed at all. Escalation only ever goes as deep as an admin
 * has actually built it; there's no fallback to some default set.
 */
export function detectStreaks(state: UserState, thresholds: TriggerConfig, root: QuestionRoot): RecommendationNudge[] {
  const newRecs: RecommendationNudge[] = [];

  for (const block of LIVE_BLOCKS) {
    const entries = state.answers.filter((a) => a.block === block && a.category).sort((a, b) => a.date.localeCompare(b.date));
    if (entries.length === 0) continue;

    const lastEntry = entries[entries.length - 1];
    const runValence = lastEntry.answer;
    const lastCategory = lastEntry.category as Category;
    const valence: "amplify" | "resolve" = runValence === "yes" ? "amplify" : "resolve";

    // A declined streak's asOfDate is a floor: entries at or before it don't
    // count toward a fresh run in this same valence direction, so a declined
    // invitation needs genuinely new days (not the same streak continuing)
    // before anything is proposed again for this block — whether that next
    // proposal would've been the same per-category invitation, or a general
    // one for the exact same underlying days reworded under different copy.
    const declined = state.declinedStreaks[block];
    const floor = declined && declined.valence === valence ? declined.asOfDate : undefined;

    let categoryRunLen = 0;
    if (!floor || lastEntry.date > floor) {
      categoryRunLen = 1;
      let prevDate = lastEntry.date;
      for (let i = entries.length - 2; i >= 0; i--) {
        const e = entries[i];
        if (floor && e.date <= floor) break;
        if (e.category === lastCategory && e.answer === runValence && isPrevCalendarDay(e.date, prevDate)) {
          categoryRunLen++;
          prevDate = e.date;
        } else {
          break;
        }
      }
    }

    let valenceRunLen = 0;
    if (!floor || lastEntry.date > floor) {
      valenceRunLen = 1;
      let prevDate = lastEntry.date;
      for (let i = entries.length - 2; i >= 0; i--) {
        const e = entries[i];
        if (floor && e.date <= floor) break;
        if (e.answer === runValence && isPrevCalendarDay(e.date, prevDate)) {
          valenceRunLen++;
          prevDate = e.date;
        } else {
          break;
        }
      }
    }

    let runCategory: Category | null = null;
    let step: EscalationStep;
    if (categoryRunLen >= thresholds.streakThreshold) {
      runCategory = lastCategory;
      step = { valence, category: lastCategory };
    } else if (valenceRunLen >= thresholds.streakThreshold) {
      step = { valence, category: null };
    } else {
      continue;
    }

    const currentPath = state.activeOverrides[block]?.path ?? [];
    const children = currentPath.length === 0 ? root.children : (resolveNode(root, currentPath)?.children ?? root.children);
    const child = step.category === null ? (step.valence === "amplify" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
    if (!child) continue; // nothing authored at this slot — no swap invite offered, no error

    const candidatePath = [...currentPath, step];

    // Dedup compares the FULL path, not just the trailing {valence, category} — two structurally
    // distinct nodes at different depths can share the same trailing step (e.g. a depth-1 node and
    // some depth-3 descendant that also happens to end in the same category/valence).
    const alreadyPending = state.pendingNudges.some((n) => n.kind === "recommendation" && n.block === block && pathsEqual(n.path, candidatePath));
    const alreadyActive = Boolean(
      state.activeOverrides[block] && pathsEqual(state.activeOverrides[block]!.path, candidatePath),
    );
    if (alreadyPending || alreadyActive) continue;

    newRecs.push({
      id: crypto.randomUUID(),
      kind: "recommendation",
      block,
      path: candidatePath,
      node: { question: child.question, yes: child.yes, no: child.no },
      category: runCategory,
      valence,
      asOfDate: lastEntry.date,
      createdAt: new Date().toISOString(),
    });
  }

  return newRecs;
}

export function acceptRecommendation(state: UserState, recommendationId: string): boolean {
  const idx = state.pendingNudges.findIndex((n) => n.kind === "recommendation" && n.id === recommendationId);
  if (idx === -1) return false;
  const rec = state.pendingNudges[idx] as RecommendationNudge;
  state.pendingNudges.splice(idx, 1);

  state.activeOverrides[rec.block] = {
    path: rec.path,
    question: rec.node.question,
    yes: rec.node.yes,
    no: rec.node.no,
    category: rec.category,
    acceptedAt: new Date().toISOString(),
  };
  // A stale decline marker for this block no longer means anything once a
  // (possibly different) invitation has actually been accepted.
  delete state.declinedStreaks[rec.block];
  return true;
}

/** The user said no — dismiss it, and remember the exact streak declined so
 * detectStreaks won't re-propose it while that same run continues. */
export function declineRecommendation(state: UserState, recommendationId: string): boolean {
  const idx = state.pendingNudges.findIndex((n) => n.kind === "recommendation" && n.id === recommendationId);
  if (idx === -1) return false;
  const rec = state.pendingNudges[idx] as RecommendationNudge;
  state.pendingNudges.splice(idx, 1);
  state.declinedStreaks[rec.block] = { category: rec.category, valence: rec.valence, asOfDate: rec.asOfDate };
  return true;
}

/** Lazily retires a promoted question once its boundary has held for thresholds.retireAfterDays with
 * no "no" answer since acceptance — reverts fully to the root question, not "one level back": a
 * QuestionOverride only ever carries its own current path, not a stack of previously-accepted parent
 * nodes, so a user who advanced root -> A -> B has retiring B jump straight back to root, discarding
 * A's accepted state too. Same flat-reset behavior this always had; the tree just gives it a real (if
 * rare) way to lose more state than a single-level override ever could. */
export function checkRetirement(state: UserState, todayStr: string, thresholds: TriggerConfig): void {
  for (const block of LIVE_BLOCKS) {
    const override = state.activeOverrides[block];
    if (!override) continue;
    const acceptedDate = override.acceptedAt.slice(0, 10);
    if (daysBetween(acceptedDate, todayStr) < thresholds.retireAfterDays) continue;

    const heldWithNoSetback = !state.answers.some(
      (a) => a.block === block && a.date >= acceptedDate && a.answer === "no",
    );
    if (heldWithNoSetback) {
      state.retiredOverrides.push(override);
      delete state.activeOverrides[block];
    }
  }
}
