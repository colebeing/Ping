import { ALL_BLOCKS, type Category, type Env, type Invitation, type Recommendation, type RecommendationCopy, type TriggerConfig, type UserState } from "./types";
import { getConfig } from "./config";

function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / msPerDay);
}

function isPrevCalendarDay(earlier: string, later: string): boolean {
  return daysBetween(earlier, later) === 1;
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
 */
export function detectStreaks(state: UserState, thresholds: TriggerConfig, copy: RecommendationCopy): Recommendation[] {
  const newRecs: Recommendation[] = [];

  for (const block of ALL_BLOCKS) {
    const entries = state.answers.filter((a) => a.block === block && a.category).sort((a, b) => a.date.localeCompare(b.date));
    if (entries.length === 0) continue;

    const lastEntry = entries[entries.length - 1];
    const runValence = lastEntry.answer;
    const lastCategory = lastEntry.category as Category;

    let categoryRunLen = 1;
    let prevDate = lastEntry.date;
    for (let i = entries.length - 2; i >= 0; i--) {
      const e = entries[i];
      if (e.category === lastCategory && e.answer === runValence && isPrevCalendarDay(e.date, prevDate)) {
        categoryRunLen++;
        prevDate = e.date;
      } else {
        break;
      }
    }

    let valenceRunLen = 1;
    prevDate = lastEntry.date;
    for (let i = entries.length - 2; i >= 0; i--) {
      const e = entries[i];
      if (e.answer === runValence && isPrevCalendarDay(e.date, prevDate)) {
        valenceRunLen++;
        prevDate = e.date;
      } else {
        break;
      }
    }

    const valence: "amplify" | "resolve" = runValence === "yes" ? "amplify" : "resolve";

    let runCategory: Category | null = null;
    let invitation: Invitation;
    if (categoryRunLen >= thresholds.streakThreshold) {
      runCategory = lastCategory;
      invitation = copy[valence][lastCategory];
    } else if (valenceRunLen >= thresholds.streakThreshold) {
      invitation = valence === "amplify" ? copy.generalYes : copy.generalNo;
    } else {
      continue;
    }

    const alreadyPending = state.pendingRecommendations.some((r) => r.block === block && r.category === runCategory && r.valence === valence);
    const alreadyActive = state.activeOverrides[block]?.category === runCategory;
    if (alreadyPending || alreadyActive) continue;

    newRecs.push({
      id: crypto.randomUUID(),
      block,
      category: runCategory,
      valence,
      invitation,
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
    how: rec.invitation.how,
    yes: rec.invitation.yes,
    no: rec.invitation.no,
    category: rec.category,
    acceptedAt: new Date().toISOString(),
  };
  return true;
}

/** Lazily retires a promoted question once its boundary has held for thresholds.retireAfterDays with no "no" answer since acceptance. */
export function checkRetirement(state: UserState, todayStr: string, thresholds: TriggerConfig): void {
  for (const block of ALL_BLOCKS) {
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
