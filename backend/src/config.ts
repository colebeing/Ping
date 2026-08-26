import type { AppConfig, BlockContent, Env, FollowupPrompt, RecommendationCopy, TriggerConfig } from "./types";

// This is the fallback used only if CONFIG_KV is empty. The real source of
// truth is the "Ping — Question Library" Google Sheet — see
// scripts/pull-sheet-content.ts, which converts it into config-seed.json for
// `npm run seed`. Edit content in the sheet, not here.
function prompt(text: string, options: Record<string, string>): FollowupPrompt {
  return { prompt: text, options: options as FollowupPrompt["options"] };
}

const CATEGORY_OPTIONS = { friends: "Friends", work: "Work", home: "Home", capacity: "Capacity" };

// Same WHAT/WHY content serves both blocks — only the base question's WHEN
// slot ("today start" vs "today end") differs between morning and evening.
const SHARED_FOLLOWUPS: Pick<BlockContent, "yes" | "no"> = {
  yes: {
    what: prompt("What did you want that you got?", CATEGORY_OPTIONS),
    why: prompt("What got you what you want?", CATEGORY_OPTIONS),
  },
  no: {
    what: prompt("What had to move?", CATEGORY_OPTIONS),
    why: prompt("What got in the way?", CATEGORY_OPTIONS),
  },
};

export const DEFAULT_CONFIG: AppConfig = {
  blocks: {
    "1": { question: { when: "today start", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
    "2": { question: { when: "today end", how: "how you wanted" }, ...SHARED_FOLLOWUPS },
  },
};

export async function getConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CONFIG_KV.get("config", "json");
  return (stored as AppConfig | null) ?? DEFAULT_CONFIG;
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

export const DEFAULT_RECOMMENDATION_COPY: RecommendationCopy = {
  amplify: {
    friends: "protect friend time today",
    work: "protect focused work time today",
    home: "protect home time today",
    capacity: "protect recovery time today",
  },
  resolve: {
    friends: "make space for friends today",
    work: "get ahead of work stress today",
    home: "get on top of home stuff today",
    capacity: "protect your energy today",
  },
};

export async function getTriggerConfig(env: Env): Promise<TriggerConfig> {
  const stored = await env.CONFIG_KV.get("config:triggers", "json");
  return (stored as TriggerConfig | null) ?? DEFAULT_TRIGGERS;
}

export async function getRecommendationCopy(env: Env): Promise<RecommendationCopy> {
  const stored = await env.CONFIG_KV.get("config:recommendation-copy", "json");
  return (stored as RecommendationCopy | null) ?? DEFAULT_RECOMMENDATION_COPY;
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
