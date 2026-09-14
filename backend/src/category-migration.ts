import { CATEGORIES, CATEGORY_LABEL, type Category, type FollowupPrompt } from "./types";

/**
 * One-time rename: the four fixed categories went from friends/colleagues/family/me to the EPIC set
 * (environment/people/impact/capacity respectively), always presented in that order now. Nothing here
 * writes anything back — every migration in this codebase is lazy-on-read (see config.ts's
 * getQuestionRoot, state.ts's getState), so old category strings can keep sitting in KV indefinitely;
 * this just makes every read transparently present the new ones. Safe to delete this whole file, and
 * every call site that imports it, once enough time has passed that no stored data could still be old.
 */
export const CATEGORY_RENAME: Record<string, Category> = {
  friends: "environment",
  family: "people",
  colleagues: "impact",
  me: "capacity",
};

/** The exact default label each old category used to seed as, before any admin customization — lets
 * the migration tell "never touched, still showing the raw old default" apart from "admin genuinely
 * typed this," so only the former gets upgraded to the new default wording. */
const OLD_CATEGORY_LABEL: Record<string, string> = { friends: "Friends", colleagues: "Colleagues", family: "Family", me: "Me" };

/** Renames one stored category value if it's still in the old friends/colleagues/family/me form;
 * already-new values (or anything unrecognized) pass through untouched. Defensive against `unknown`
 * since a value read straight out of KV JSON isn't guaranteed to match its declared type at runtime. */
export function migrateCategoryValue(raw: unknown): Category | undefined {
  if (typeof raw !== "string") return undefined;
  if ((CATEGORIES as string[]).includes(raw)) return raw as Category;
  return CATEGORY_RENAME[raw];
}

/** Rekeys a FollowupPrompt's per-category options from old category ids to new ones. An option whose
 * text is byte-identical to the OLD default label for its category (i.e. never customized away from
 * the seed) gets upgraded to the corresponding NEW default label too, so a never-touched button doesn't
 * keep reading a stale category name; any genuinely custom text just moves under the new key untouched.
 * Idempotent — already-new-shape data (values already sitting under the new keys) passes straight
 * through, so this is safe to call unconditionally on every read regardless of whether migration has
 * already happened for this particular record. */
export function migrateFollowupPromptCategories(prompt: FollowupPrompt): FollowupPrompt {
  const raw = prompt.options as unknown as Partial<Record<string, string>>;
  const options = {} as Record<Category, string>;
  for (const [oldCat, newCat] of Object.entries(CATEGORY_RENAME)) {
    if (raw[newCat] !== undefined) {
      options[newCat] = raw[newCat]!;
    } else if (raw[oldCat] !== undefined) {
      options[newCat] = raw[oldCat] === OLD_CATEGORY_LABEL[oldCat] ? CATEGORY_LABEL[newCat] : raw[oldCat]!;
    } else {
      options[newCat] = "";
    }
  }
  return { prompt: prompt.prompt, options };
}
