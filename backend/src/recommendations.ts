import type { BlockId, Category, Env, Recommendation, UserState } from "./types";
import { getConfig } from "./config";

const STREAK_THRESHOLD = 3; // consecutive days — spec says "streaks, not single instances" without a fixed number
const RETIRE_AFTER_DAYS = 7;

const AMPLIFY_HOW: Record<Category, string> = {
  friends: "protect friend time today",
  work: "protect focused work time today",
  home: "protect home time today",
  capacity: "protect recovery time today",
};

const RESOLVE_HOW: Record<Category, string> = {
  friends: "make space for friends today",
  work: "get ahead of work stress today",
  home: "get on top of home stuff today",
  capacity: "protect your energy today",
};

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / msPerDay);
}

function isPrevCalendarDay(earlier: string, later: string): boolean {
  return daysBetween(earlier, later) === 1;
}

/**
 * Looks for a trailing run (most recent N consecutive days, same block, same
 * "what" category, same yes/no valence) and proposes a recommendation.
 * Amplify for yes-streaks (do more of what's working), resolve for
 * no-streaks — symmetric per spec.
 */
export function detectStreaks(state: UserState): Recommendation[] {
  const newRecs: Recommendation[] = [];
  const blocks: BlockId[] = ["1", "2"];

  for (const block of blocks) {
    const entries = state.answers.filter((a) => a.block === block && a.what).sort((a, b) => a.date.localeCompare(b.date));
    if (entries.length === 0) continue;

    let runLen = 1;
    let prevDate = entries[entries.length - 1].date;
    const runCategory = entries[entries.length - 1].what as Category;
    const runValence = entries[entries.length - 1].answer;

    for (let i = entries.length - 2; i >= 0; i--) {
      const e = entries[i];
      if (e.what === runCategory && e.answer === runValence && isPrevCalendarDay(e.date, prevDate)) {
        runLen++;
        prevDate = e.date;
      } else {
        break;
      }
    }

    if (runLen < STREAK_THRESHOLD) continue;

    const valence: "amplify" | "resolve" = runValence === "yes" ? "amplify" : "resolve";
    const alreadyPending = state.pendingRecommendations.some((r) => r.block === block && r.category === runCategory && r.valence === valence);
    const alreadyActive = state.activeOverrides[block]?.category === runCategory;
    if (alreadyPending || alreadyActive) continue;

    newRecs.push({
      id: crypto.randomUUID(),
      block,
      category: runCategory,
      valence,
      suggestedHow: (valence === "amplify" ? AMPLIFY_HOW : RESOLVE_HOW)[runCategory],
      createdAt: new Date().toISOString(),
    });
  }

  return newRecs;
}

export async function acceptRecommendation(env: Env, state: UserState, recommendationId: string): Promise<boolean> {
  const idx = state.pendingRecommendations.findIndex((r) => r.id === recommendationId);
  if (idx === -1) return false;
  const rec = state.pendingRecommendations[idx];
  state.pendingRecommendations.splice(idx, 1);

  const config = await getConfig(env);
  state.activeOverrides[rec.block] = {
    when: config.blocks[rec.block].question.when,
    how: rec.suggestedHow,
    category: rec.category,
    acceptedAt: new Date().toISOString(),
  };
  return true;
}

/** Lazily retires a promoted question once its boundary has held for RETIRE_AFTER_DAYS with no "no" answer since acceptance. */
export function checkRetirement(state: UserState, todayStr: string): void {
  for (const block of ["1", "2"] as BlockId[]) {
    const override = state.activeOverrides[block];
    if (!override) continue;
    const acceptedDate = override.acceptedAt.slice(0, 10);
    if (daysBetween(acceptedDate, todayStr) < RETIRE_AFTER_DAYS) continue;

    const heldWithNoSetback = !state.answers.some(
      (a) => a.block === block && a.date >= acceptedDate && a.answer === "no",
    );
    if (heldWithNoSetback) {
      state.retiredOverrides.push(override);
      delete state.activeOverrides[block];
    }
  }
}
