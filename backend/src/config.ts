import {
  LIVE_BLOCKS,
  type AppConfig,
  type BlockContent,
  type ConfigAuditEntry,
  type Env,
  type EscalationChildren,
  type EscalationNode,
  type FollowupPrompt,
  type LiveBlockId,
  type QuestionRoot,
  type TriggerConfig,
} from "./types";

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

/** Frozen legacy blocks only — never edited again, kept purely so History reads old answered days
 * correctly. Live q1-q4 content lives entirely in DEFAULT_QUESTION_ROOT/QuestionRoot instead. */
export const DEFAULT_CONFIG: AppConfig = {
  blocks: {
    "1": { question: "Did today start how you wanted?", ...SHARED_FOLLOWUPS },
    "2": { question: "Did today end how you wanted?", ...SHARED_FOLLOWUPS },
    combined: { question: "Did today go how you wanted?", ...SHARED_FOLLOWUPS },
  },
};

export async function getConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CONFIG_KV.get<AppConfig>("config", "json");
  if (!stored) return DEFAULT_CONFIG;
  // Backfill for config saved before the "combined" block existed.
  if (!stored.blocks.combined) stored.blocks.combined = DEFAULT_CONFIG.blocks.combined;
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
// npm run seed, scripts/generate-config-seed.ts) can never clobber admin-edited triggers/question-tree
// content, and vice versa.
export const DEFAULT_TRIGGERS: TriggerConfig = {
  exactPathThreshold: 3,
  categoryVolumeThreshold: 6,
  streakThreshold: 3,
  retireAfterDays: 7,
};

// One complete, block-agnostic question per swap invite — no when/how composition, no per-block
// variants (only the one block whose streak produced it is ever overridden with it). Phrased as an
// explicit "Would you like to...?" confirmation, deliberately distinct in voice from the routine
// question's "Did...?" framing, so it reads as an invitation to change rather than another check-in.
function leaf(question: string): EscalationNode {
  return { question, ...SHARED_FOLLOWUPS, children: { amplify: {}, resolve: {} } };
}

const DEFAULT_ESCALATION_CHILDREN: EscalationChildren = {
  amplify: {
    friends: leaf("Would you like to focus on protecting friend time?"),
    colleagues: leaf("Would you like to focus on leaning on your colleagues?"),
    family: leaf("Would you like to focus on protecting family time?"),
    me: leaf("Would you like to focus on protecting time for yourself?"),
  },
  resolve: {
    friends: leaf("Would you like to focus on making space for friends?"),
    colleagues: leaf("Would you like to focus on getting ahead of what colleagues need?"),
    family: leaf("Would you like to focus on making space for family?"),
    me: leaf("Would you like to focus on protecting your own time?"),
  },
  generalYes: leaf("Would you like to keep doing what's working?"),
  generalNo: leaf("Would you like to get ahead of what's pulling at you?"),
};

export const DEFAULT_QUESTION_ROOT: QuestionRoot = {
  blockQuestions: {
    q1: "Did today start how you wanted?",
    q2: "Did this morning go how you wanted?",
    q3: "Did this afternoon go how you wanted?",
    q4: "Did today end how you wanted?",
  },
  ...SHARED_FOLLOWUPS,
  children: DEFAULT_ESCALATION_CHILDREN,
};

/** Best-effort extraction of a single flat question string from whatever's sitting in the old flat
 * invitation shape (`{texts: Record<LiveBlockId,string>, ...}`, from the immediately-prior refactor) —
 * picks `.texts.q1` as an arbitrary-but-consistent choice across 4 near-duplicate texts. Any other/
 * older/incompatible shape just yields null, left unauthored — a perfectly normal state in this model,
 * not an error, so there's no need to chase every historical shape here. */
function extractLegacyInvitationText(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "texts" in raw) {
    const texts = (raw as { texts?: unknown }).texts;
    if (texts && typeof texts === "object" && "q1" in texts) {
      const q1 = (texts as Record<string, unknown>).q1;
      if (typeof q1 === "string") return q1;
    }
  }
  return null;
}

/** Best-effort migration of the old flat 10-invitation shape (`config:recommendation-copy`) into
 * depth-1 EscalationChildren — each becomes a leaf with no children of its own (nothing was ever
 * authored deeper than depth 1 before this tree existed). Any slot that can't be salvaged is simply
 * left unauthored rather than guessed at. */
function migrateEscalationChildren(rawCopy: Record<string, unknown> | null): EscalationChildren {
  const children: EscalationChildren = { amplify: {}, resolve: {} };
  if (!rawCopy) return children;
  const amplify = rawCopy.amplify as Record<string, unknown> | undefined;
  const resolve = rawCopy.resolve as Record<string, unknown> | undefined;
  for (const cat of ["friends", "colleagues", "family", "me"] as const) {
    const aText = amplify && extractLegacyInvitationText(amplify[cat]);
    if (aText) children.amplify[cat] = leaf(aText);
    const rText = resolve && extractLegacyInvitationText(resolve[cat]);
    if (rText) children.resolve[cat] = leaf(rText);
  }
  const generalYesText = extractLegacyInvitationText(rawCopy.generalYes);
  if (generalYesText) children.generalYes = leaf(generalYesText);
  const generalNoText = extractLegacyInvitationText(rawCopy.generalNo);
  if (generalNoText) children.generalNo = leaf(generalNoText);
  return children;
}

/**
 * The whole live question tree. No write-on-read: if `config:question-root` is empty, this computes
 * and RETURNS a seeded value without persisting it — a concurrent Admin save landing between a read
 * and a would-be write here could otherwise get silently clobbered by stale seeded data written after
 * it (getConfig/this function's predecessor never wrote on read either). The seed only actually
 * persists the first time an admin saves, which round-trips the whole computed tree back through the
 * normal save path regardless of whether anyone ever merely viewed the Admin page first.
 */
export async function getQuestionRoot(env: Env): Promise<QuestionRoot> {
  const stored = await env.CONFIG_KV.get<QuestionRoot>("config:question-root", "json");
  if (stored) return stored;

  // Nothing saved under the new key yet — seed from whatever's sitting in the older "config"/
  // "config:recommendation-copy" keys, if anything. Read the RAW blob: AppConfig's type no longer
  // declares q1-q4, but existing KV bytes from before this migration may still carry them.
  const rawConfig = await env.CONFIG_KV.get<{ blocks?: Record<string, { question?: unknown; yes?: FollowupPrompt; no?: FollowupPrompt }> }>(
    "config",
    "json",
  );
  const rawQ1 = rawConfig?.blocks?.q1;
  if (!rawQ1) return DEFAULT_QUESTION_ROOT;

  const blockQuestions = {} as Record<LiveBlockId, string>;
  for (const block of LIVE_BLOCKS) {
    const raw = rawConfig?.blocks?.[block];
    const q = raw?.question;
    if (typeof q === "string") blockQuestions[block] = q;
    else if (q && typeof q === "object") {
      const old = q as unknown as { when: string; how: string };
      blockQuestions[block] = `Did ${old.when} ${old.how}?`;
    } else blockQuestions[block] = DEFAULT_QUESTION_ROOT.blockQuestions[block];
  }

  const rawCopy = await env.CONFIG_KV.get<Record<string, unknown>>("config:recommendation-copy", "json");

  return {
    blockQuestions,
    yes: rawQ1.yes ?? DEFAULT_QUESTION_ROOT.yes,
    no: rawQ1.no ?? DEFAULT_QUESTION_ROOT.no,
    children: migrateEscalationChildren(rawCopy),
  };
}

export interface FullAdminConfig {
  blocks: AppConfig["blocks"];
  triggers: TriggerConfig;
  questionRoot: QuestionRoot;
}

export async function getFullAdminConfig(env: Env): Promise<FullAdminConfig> {
  const [config, triggers, questionRoot] = await Promise.all([getConfig(env), getTriggerConfig(env), getQuestionRoot(env)]);
  return { blocks: config.blocks, triggers, questionRoot };
}

export async function getTriggerConfig(env: Env): Promise<TriggerConfig> {
  const stored = await env.CONFIG_KV.get("config:triggers", "json");
  return (stored as TriggerConfig | null) ?? DEFAULT_TRIGGERS;
}

const CONFIG_AUDIT_LOG_LIMIT = 50;

export async function saveFullAdminConfig(env: Env, full: FullAdminConfig, editedBy: string): Promise<void> {
  const log = await getConfigAuditLog(env);
  log.push({ editedBy, editedAt: new Date().toISOString() });
  while (log.length > CONFIG_AUDIT_LOG_LIMIT) log.shift();

  await Promise.all([
    env.CONFIG_KV.put("config", JSON.stringify({ blocks: full.blocks })),
    env.CONFIG_KV.put("config:triggers", JSON.stringify(full.triggers)),
    env.CONFIG_KV.put("config:question-root", JSON.stringify(full.questionRoot)),
    env.CONFIG_KV.put("config:audit-log", JSON.stringify(log)),
  ]);
}

/** Who changed the admin config and when — global (not per-user), most recent last, capped to the last 50 saves. */
export async function getConfigAuditLog(env: Env): Promise<ConfigAuditEntry[]> {
  return (await env.CONFIG_KV.get<ConfigAuditEntry[]>("config:audit-log", "json")) ?? [];
}
