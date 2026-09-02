import type { AppConfig, BlockContent, Env, FollowupPrompt, Invitation, RecommendationCopy, TriggerConfig } from "./types";

// This is the fallback used only if CONFIG_KV is empty. The real source of
// truth is the "Ping — Question Library" Google Sheet — see
// scripts/pull-sheet-content.ts, which converts it into config-seed.json for
// `npm run seed`. Edit content in the sheet, not here.
function prompt(text: string, options: Record<string, string>): FollowupPrompt {
  return { prompt: text, options: options as FollowupPrompt["options"] };
}

const CATEGORY_OPTIONS = { friends: "Friends", colleagues: "Colleagues", family: "Family", me: "Me" };

// Same WHY content serves both blocks — only the base question's WHEN slot
// ("today start" vs "today end") differs between morning and evening.
const SHARED_FOLLOWUPS: Pick<BlockContent, "yes" | "no"> = {
  yes: prompt("Who made it work?", CATEGORY_OPTIONS),
  no: prompt("Who had to move?", CATEGORY_OPTIONS),
};

export const DEFAULT_CONFIG: AppConfig = {
  blocks: {
    "1": { question: { when: "today start", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    "2": { question: { when: "today end", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    // The once-daily question. Same WHAT/WHY content as block 1 (mirrored on
    // every admin save, same convention as block 2) — only its own WHEN slot differs.
    combined: { question: { when: "today go", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    // The four four-times-daily questions, each with its own WHEN slot.
    // Start of day/End of day mirror blocks "1"/"2"'s WHEN exactly (admin
    // edits those, not separate fields); Morning/Afternoon are their own
    // admin-editable slots, independent of "1"/"2"'s Morning/Evening.
    q1: { question: { when: "today start", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    q2: { question: { when: "this morning go", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    q3: { question: { when: "this afternoon go", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    q4: { question: { when: "today end", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
  },
};

export async function getConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CONFIG_KV.get<AppConfig>("config", "json");
  if (!stored) return DEFAULT_CONFIG;
  // Backfill for config saved before the "combined" block existed.
  if (!stored.blocks.combined) stored.blocks.combined = DEFAULT_CONFIG.blocks.combined;
  // Backfill for config saved before the four-times-daily blocks existed.
  // Mirrors "1"'s current HOW/WHY (same as admin.ts does on every save) rather
  // than the hardcoded default, so an account with customized WHY content
  // doesn't see the generic default until its next Admin save.
  for (const block of ["q1", "q2", "q3", "q4"] as const) {
    if (!stored.blocks[block]) {
      stored.blocks[block] = {
        ...JSON.parse(JSON.stringify(stored.blocks["1"])),
        question: { ...stored.blocks["1"].question, when: DEFAULT_CONFIG.blocks[block].question.when },
      };
    }
  }
  return stored;
}

// Kept in separate KV keys from "config" (question content) on purpose: the
// Google Sheet pull (scripts/pull-sheet-content.ts) only ever writes "config",
// so admin-edited triggers/recommendation copy can never get clobbered by a
// content re-seed, and vice versa.
export const DEFAULT_TRIGGERS: TriggerConfig = {
  exactPathThreshold: 3,
  categoryVolumeThreshold: 6,
  streakThreshold: 3,
  retireAfterDays: 7,
};

function invitation(how: string): Invitation {
  return { how, ...SHARED_FOLLOWUPS };
}

export const DEFAULT_RECOMMENDATION_COPY: RecommendationCopy = {
  amplify: {
    friends: invitation("protect friend time today"),
    colleagues: invitation("lean on your colleagues today"),
    family: invitation("protect family time today"),
    me: invitation("protect time for yourself today"),
  },
  resolve: {
    friends: invitation("make space for friends today"),
    colleagues: invitation("get ahead of what colleagues need today"),
    family: invitation("make space for family today"),
    me: invitation("protect your own time today"),
  },
  generalYes: invitation("keep doing what's working today"),
  generalNo: invitation("get ahead of what's pulling at you today"),
};

export async function getTriggerConfig(env: Env): Promise<TriggerConfig> {
  const stored = await env.CONFIG_KV.get("config:triggers", "json");
  return (stored as TriggerConfig | null) ?? DEFAULT_TRIGGERS;
}

export async function getRecommendationCopy(env: Env): Promise<RecommendationCopy> {
  const stored = await env.CONFIG_KV.get<RecommendationCopy>("config:recommendation-copy", "json");
  if (!stored) return DEFAULT_RECOMMENDATION_COPY;
  // Recommendation copy used to be a plain string per category/valence (just
  // the HOW slot) — a stored value in that old shape, or missing the general
  // slots added alongside it, can't be salvaged piecemeal, so fall back whole.
  if (typeof stored.amplify?.friends === "string" || !stored.generalYes || !stored.generalNo) {
    return DEFAULT_RECOMMENDATION_COPY;
  }
  return stored;
}

export interface FullAdminConfig {
  blocks: AppConfig["blocks"];
  triggers: TriggerConfig;
  recommendationCopy: RecommendationCopy;
}

export async function getFullAdminConfig(env: Env): Promise<FullAdminConfig> {
  const [config, triggers, recommendationCopy] = await Promise.all([getConfig(env), getTriggerConfig(env), getRecommendationCopy(env)]);
  return { blocks: config.blocks, triggers, recommendationCopy };
}

export async function saveFullAdminConfig(env: Env, full: FullAdminConfig): Promise<void> {
  await Promise.all([
    env.CONFIG_KV.put("config", JSON.stringify({ blocks: full.blocks })),
    env.CONFIG_KV.put("config:triggers", JSON.stringify(full.triggers)),
    env.CONFIG_KV.put("config:recommendation-copy", JSON.stringify(full.recommendationCopy)),
  ]);
}
