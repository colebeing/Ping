import { CATEGORY_CODE, type Answer, type BlockId, type BranchEvent, type Category, type TriggerConfig, type UserState } from "./types";

/** Path key per spec notation: {block}{y/n}{category}, e.g. "1nc". */
export function pathKey(block: BlockId, answer: Answer, category: Category): string {
  const yn = answer === "yes" ? "y" : "n";
  return `${block}${yn}${CATEGORY_CODE[category]}`;
}

export interface EscalationResult {
  triggers: BranchEvent[];
  /** The trigger that takes UI precedence when more than one fires on this event. */
  primary: BranchEvent | null;
}

/**
 * Records one follow-up (WHY) category pick and evaluates both escalation
 * triggers. Mutates `state` in place. Both counters always run and never
 * reset (all-time), regardless of which trigger fires.
 */
export function recordFollowupEvent(
  state: UserState,
  block: BlockId,
  answer: Answer,
  category: Category,
  thresholds: TriggerConfig,
): EscalationResult {
  const key = pathKey(block, answer, category);
  const newPathCount = (state.pathCounts[key] ?? 0) + 1;
  state.pathCounts[key] = newPathCount;

  const newCategoryCount = (state.categoryCounts[category] ?? 0) + 1;
  state.categoryCounts[category] = newCategoryCount;

  const triggers: BranchEvent[] = [];
  if (newPathCount === thresholds.exactPathThreshold) {
    triggers.push({ kind: "exact-path", pathKey: key, category, count: newPathCount });
  }
  if (newCategoryCount === thresholds.categoryVolumeThreshold) {
    triggers.push({ kind: "category-volume", category, count: newCategoryCount });
  }

  // Precedence: exact-path is the cleanest signal and wins when both fire on
  // the same event. Both counts are persisted above regardless of outcome.
  const primary = triggers.find((t) => t.kind === "exact-path") ?? triggers[0] ?? null;

  return { triggers, primary };
}

/**
 * Undoes a previously recorded follow-up event. Used when a user edits a
 * post-hoc answer/follow-up so counters stay accurate rather than double-counting.
 */
export function decrementFollowupEvent(state: UserState, block: BlockId, answer: Answer, category: Category): void {
  const key = pathKey(block, answer, category);
  if (state.pathCounts[key]) state.pathCounts[key] = Math.max(0, state.pathCounts[key] - 1);
  if (state.categoryCounts[category]) state.categoryCounts[category] = Math.max(0, state.categoryCounts[category] - 1);
}
