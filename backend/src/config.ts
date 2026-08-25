import type { AppConfig, BlockContent, Env, FollowupPrompt } from "./types";

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
