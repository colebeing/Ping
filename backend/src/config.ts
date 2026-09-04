import type { AppConfig, BlockContent, ConfigAuditEntry, Env, FollowupPrompt, Invitation, LiveBlockId, RecommendationCopy, TriggerConfig } from "./types";

// This is the fallback used only if CONFIG_KV is empty. The Admin UI is the canonical, sole place to
// edit live content — see scripts/generate-config-seed.ts for regenerating scripts/config-seed.json
// from this file (e.g. for seeding a fresh KV namespace), the only other writer of that file.
function prompt(text: string, options: Record<string, string>): FollowupPrompt {
  return { prompt: text, options: options as FollowupPrompt["options"] };
}

const CATEGORY_OPTIONS = { friends: "Friends", colleagues: "Colleagues", family: "Family", me: "Me" };

// Same WHY content serves every block by default — only the base question itself differs per block.
const SHARED_FOLLOWUPS: Pick<BlockContent, "yes" | "no"> = {
  yes: prompt("Who made it work?", CATEGORY_OPTIONS),
  no: prompt("Who had to move?", CATEGORY_OPTIONS),
};

export const DEFAULT_CONFIG: AppConfig = {
  blocks: {
    // Frozen legacy blocks — never edited again, kept only so History reads old answered days correctly.
    "1": { question: "Did today start how you wanted?", ...SHARED_FOLLOWUPS },
    "2": { question: "Did today end how you wanted?", ...SHARED_FOLLOWUPS },
    combined: { question: "Did today go how you wanted?", ...SHARED_FOLLOWUPS },
    // The four live blocks — each a complete, independently-editable question, no when/how composition.
    q1: { question: "Did today start how you wanted?", ...SHARED_FOLLOWUPS },
    q2: { question: "Did this morning go how you wanted?", ...SHARED_FOLLOWUPS },
    q3: { question: "Did this afternoon go how you wanted?", ...SHARED_FOLLOWUPS },
    q4: { question: "Did today end how you wanted?", ...SHARED_FOLLOWUPS },
  },
};

export async function getConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CONFIG_KV.get<AppConfig>("config", "json");
  if (!stored) return DEFAULT_CONFIG;
  // Backfill for config saved before the "combined" block existed.
  if (!stored.blocks.combined) stored.blocks.combined = DEFAULT_CONFIG.blocks.combined;
  // Backfill for config saved before the four-times-daily blocks existed — effectively dead for any
  // environment that's had an Admin save since q1-q4 shipped (they're always populated after that).
  // Copies "1"'s current WHY (admin.ts's own mirror source has since moved to "q1") rather than the
  // hardcoded default, so an account with customized WHY content doesn't see the generic default
  // until its next Admin save. The question itself falls back to the default wholesale — there's no
  // "1"'s-question-with-just-the-when-swapped to salvage once question is a single opaque string.
  for (const block of ["q1", "q2", "q3", "q4"] as const) {
    if (!stored.blocks[block]) {
      stored.blocks[block] = {
        yes: JSON.parse(JSON.stringify(stored.blocks["1"].yes)),
        no: JSON.parse(JSON.stringify(stored.blocks["1"].no)),
        question: DEFAULT_CONFIG.blocks[block].question,
      };
    }
  }
  // Old when/how template shape -> one complete question string per block. Mechanically lossless:
  // reproduces exactly the text a user was already seeing, whatever its grammatical quality.
  for (const block of Object.keys(stored.blocks) as (keyof AppConfig["blocks"])[]) {
    const content = stored.blocks[block];
    if (content && typeof content.question !== "string") {
      const old = content.question as unknown as { when: string; how: string };
      stored.blocks[block] = { ...content, question: `Did ${old.when} ${old.how}?` };
    }
  }
  return stored;
}

// Kept in separate KV keys from "config" (question content) so a fresh question-content seed (e.g.
// npm run seed, scripts/generate-config-seed.ts) can never clobber admin-edited triggers/recommendation
// copy, and vice versa.
export const DEFAULT_TRIGGERS: TriggerConfig = {
  exactPathThreshold: 3,
  categoryVolumeThreshold: 6,
  streakThreshold: 3,
  retireAfterDays: 7,
};

// One complete question per canonical block per invitation — no when/how composition. Each family of
// 4 reads standalone regardless of which block the streak that triggered it happened on.
function invitation(texts: Record<LiveBlockId, string>): Invitation {
  return { texts, ...SHARED_FOLLOWUPS };
}

export const DEFAULT_RECOMMENDATION_COPY: RecommendationCopy = {
  amplify: {
    friends: invitation({
      q1: "Did today start with protecting friend time?",
      q2: "Did this morning go by protecting friend time?",
      q3: "Did this afternoon go by protecting friend time?",
      q4: "Did today end with protecting friend time?",
    }),
    colleagues: invitation({
      q1: "Did today start with leaning on your colleagues?",
      q2: "Did this morning go by leaning on your colleagues?",
      q3: "Did this afternoon go by leaning on your colleagues?",
      q4: "Did today end with leaning on your colleagues?",
    }),
    family: invitation({
      q1: "Did today start with protecting family time?",
      q2: "Did this morning go by protecting family time?",
      q3: "Did this afternoon go by protecting family time?",
      q4: "Did today end with protecting family time?",
    }),
    me: invitation({
      q1: "Did today start with protecting time for yourself?",
      q2: "Did this morning go by protecting time for yourself?",
      q3: "Did this afternoon go by protecting time for yourself?",
      q4: "Did today end with protecting time for yourself?",
    }),
  },
  resolve: {
    friends: invitation({
      q1: "Did today start with making space for friends?",
      q2: "Did this morning go by making space for friends?",
      q3: "Did this afternoon go by making space for friends?",
      q4: "Did today end with making space for friends?",
    }),
    colleagues: invitation({
      q1: "Did today start ahead of what colleagues needed?",
      q2: "Did this morning go ahead of what colleagues needed?",
      q3: "Did this afternoon go ahead of what colleagues needed?",
      q4: "Did today end ahead of what colleagues needed?",
    }),
    family: invitation({
      q1: "Did today start with making space for family?",
      q2: "Did this morning go by making space for family?",
      q3: "Did this afternoon go by making space for family?",
      q4: "Did today end with making space for family?",
    }),
    me: invitation({
      q1: "Did today start with protecting your own time?",
      q2: "Did this morning go by protecting your own time?",
      q3: "Did this afternoon go by protecting your own time?",
      q4: "Did today end with protecting your own time?",
    }),
  },
  generalYes: invitation({
    q1: "Did today start with more of what's working?",
    q2: "Did this morning go by keeping doing what's working?",
    q3: "Did this afternoon go by keeping doing what's working?",
    q4: "Did today end with more of what's working?",
  }),
  generalNo: invitation({
    q1: "Did today start ahead of what's pulling at you?",
    q2: "Did this morning go ahead of what's pulling at you?",
    q3: "Did this afternoon go ahead of what's pulling at you?",
    q4: "Did today end ahead of what's pulling at you?",
  }),
};

export async function getTriggerConfig(env: Env): Promise<TriggerConfig> {
  const stored = await env.CONFIG_KV.get("config:triggers", "json");
  return (stored as TriggerConfig | null) ?? DEFAULT_TRIGGERS;
}

export async function getRecommendationCopy(env: Env): Promise<RecommendationCopy> {
  const stored = await env.CONFIG_KV.get<RecommendationCopy>("config:recommendation-copy", "json");
  if (!stored) return DEFAULT_RECOMMENDATION_COPY;
  // Recommendation copy has gone through two incompatible old shapes now — a plain string per
  // category/valence (just the HOW slot, oldest), then a {how,yes,no} object (one HOW fragment,
  // composed against whichever block's WHEN was live). Neither can be salvaged piecemeal into the
  // current {texts,yes,no} shape (four independent complete questions), so any admin-customized
  // copy in an old shape resets to the new defaults — same "fall back whole" precedent this function
  // has always used, just one more shape it now also catches.
  if (typeof stored.amplify?.friends === "string" || !stored.generalYes || !stored.generalNo || !("texts" in stored.amplify.friends)) {
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

const CONFIG_AUDIT_LOG_LIMIT = 50;

export async function saveFullAdminConfig(env: Env, full: FullAdminConfig, editedBy: string): Promise<void> {
  const log = await getConfigAuditLog(env);
  log.push({ editedBy, editedAt: new Date().toISOString() });
  while (log.length > CONFIG_AUDIT_LOG_LIMIT) log.shift();

  await Promise.all([
    env.CONFIG_KV.put("config", JSON.stringify({ blocks: full.blocks })),
    env.CONFIG_KV.put("config:triggers", JSON.stringify(full.triggers)),
    env.CONFIG_KV.put("config:recommendation-copy", JSON.stringify(full.recommendationCopy)),
    env.CONFIG_KV.put("config:audit-log", JSON.stringify(log)),
  ]);
}

/** Who changed the admin config and when — global (not per-user), most recent last, capped to the last 50 saves. */
export async function getConfigAuditLog(env: Env): Promise<ConfigAuditEntry[]> {
  return (await env.CONFIG_KV.get<ConfigAuditEntry[]>("config:audit-log", "json")) ?? [];
}
