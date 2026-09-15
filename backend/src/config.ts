import {
  CATEGORY_LABEL,
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
import { CATEGORY_RENAME, migrateFollowupPromptCategories } from "./category-migration";

// This is the fallback used only if CONFIG_KV is empty. The Admin UI is the canonical, sole place to
// edit live content — see scripts/generate-config-seed.ts for regenerating scripts/config-seed.json
// from this file (e.g. for seeding a fresh KV namespace), the only other writer of that file.
function prompt(text: string, options: Record<string, string>): FollowupPrompt {
  return { prompt: text, options: options as FollowupPrompt["options"] };
}

// Same WHY content serves every block by default — only the base question itself differs per block.
const SHARED_FOLLOWUPS: Pick<BlockContent, "yes" | "no"> = {
  yes: prompt("Who made it work?", CATEGORY_LABEL),
  no: prompt("Who had to move?", CATEGORY_LABEL),
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
  categoryYesThreshold: 3,
  categoryNoThreshold: 3,
  generalYesThreshold: 3,
  generalNoThreshold: 3,
  retireAfterDays: 7,
};

// Phrased as an explicit "Would you like to...?" confirmation, deliberately distinct in voice from the
// routine question's "Did...?" framing, so it reads as an invitation to change rather than another
// check-in. The same text seeds all 4 timed slots by default (admins differentiate later, exactly as
// they would for root) since accepting changes every block's question at once, not just one.
function leaf(question: string): EscalationNode {
  return {
    inviteQuestion: question,
    blockQuestions: { q1: question, q2: question, q3: question, q4: question },
    ...SHARED_FOLLOWUPS,
    children: { yes: {}, no: {} },
  };
}

const DEFAULT_ESCALATION_CHILDREN: EscalationChildren = {
  yes: {
    // Wording carried over verbatim from the old friends/colleagues/family/me set — only the keys
    // renamed to their EPIC equivalents (see category-migration.ts). Fallback-only content (never
    // touched again once CONFIG_KV has real content), so it's not worth rewriting the phrasing itself.
    environment: leaf("Would you like to focus on protecting friend time?"),
    impact: leaf("Would you like to focus on leaning on your colleagues?"),
    people: leaf("Would you like to focus on protecting family time?"),
    capacity: leaf("Would you like to focus on protecting time for yourself?"),
  },
  no: {
    environment: leaf("Would you like to focus on making space for friends?"),
    impact: leaf("Would you like to focus on getting ahead of what colleagues need?"),
    people: leaf("Would you like to focus on making space for family?"),
    capacity: leaf("Would you like to focus on protecting your own time?"),
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
  const children: EscalationChildren = { yes: {}, no: {} };
  if (!rawCopy) return children;
  // Raw key names ("amplify"/"resolve") reflect this ancient blob's own historical shape, predating
  // both the EPIC category rename below AND the later amplify/resolve -> yes/no valence rename — not
  // worth updating since this whole blob is frozen, never written again once CONFIG_KV has real
  // question-root content.
  const amplify = rawCopy.amplify as Record<string, unknown> | undefined;
  const resolve = rawCopy.resolve as Record<string, unknown> | undefined;
  // This raw blob predates the EPIC rename entirely, so its keys are still friends/colleagues/family/
  // me — read via CATEGORY_RENAME's old keys, write under the new ones (same as everywhere else).
  for (const [oldCat, newCat] of Object.entries(CATEGORY_RENAME)) {
    const aText = amplify && extractLegacyInvitationText(amplify[oldCat]);
    if (aText) children.yes[newCat] = leaf(aText);
    const rText = resolve && extractLegacyInvitationText(resolve[oldCat]);
    if (rText) children.no[newCat] = leaf(rText);
  }
  const generalYesText = extractLegacyInvitationText(rawCopy.generalYes);
  if (generalYesText) children.generalYes = leaf(generalYesText);
  const generalNoText = extractLegacyInvitationText(rawCopy.generalNo);
  if (generalNoText) children.generalNo = leaf(generalNoText);
  return children;
}

/** A node's shape before the per-block-override change had one flat `question` string instead of
 * `inviteQuestion` + `blockQuestions` (4 timed phrasings) — mechanically lossless: the same text
 * becomes both the invite confirmation and all 4 timed slots, exactly what a user was already seeing
 * on every block once this node's invite was accepted. */
function migrateNodeShape(node: EscalationNode): EscalationNode {
  const raw = node as unknown as { question?: string; blockQuestions?: Record<LiveBlockId, string> };
  const upgraded: EscalationNode = raw.blockQuestions
    ? node
    : {
        inviteQuestion: raw.question ?? "",
        blockQuestions: { q1: raw.question ?? "", q2: raw.question ?? "", q3: raw.question ?? "", q4: raw.question ?? "" },
        yes: node.yes,
        no: node.no,
        children: node.children,
      };
  return {
    ...upgraded,
    yes: migrateFollowupPromptCategories(upgraded.yes),
    no: migrateFollowupPromptCategories(upgraded.no),
    children: migrateChildrenShape(upgraded.children),
  };
}

/** Renames pre-EPIC category keys (friends/colleagues/family/me) to their EPIC equivalents wherever
 * they appear as EscalationChildren's own yes/no slots — see category-migration.ts. Also renames the
 * slots themselves from their pre-rename names (amplify/resolve) to the current yes/no, one rename
 * layered on top of the other exactly like migrateNodeShape/migrateFollowupPromptCategories compose.
 * Reads via both the new key and the old one at each level so this is idempotent: already-migrated
 * data (only new keys present, at both levels) passes straight through untouched. */
function migrateChildrenShape(children: EscalationChildren): EscalationChildren {
  const migrated: EscalationChildren = { yes: {}, no: {} };
  const raw = children as unknown as Record<string, Partial<Record<string, EscalationNode>> | undefined>;
  const rawYes = raw.yes ?? raw.amplify ?? {};
  const rawNo = raw.no ?? raw.resolve ?? {};
  for (const [oldCat, newCat] of Object.entries(CATEGORY_RENAME)) {
    const y = rawYes[newCat] ?? rawYes[oldCat];
    if (y) migrated.yes[newCat] = migrateNodeShape(y);
    const n = rawNo[newCat] ?? rawNo[oldCat];
    if (n) migrated.no[newCat] = migrateNodeShape(n);
  }
  if (children.generalYes) migrated.generalYes = migrateNodeShape(children.generalYes);
  if (children.generalNo) migrated.generalNo = migrateNodeShape(children.generalNo);
  return migrated;
}

/**
 * The whole live question tree. No write-on-read: if `config:question-root` is empty, this computes
 * and RETURNS a seeded value without persisting it — a concurrent Admin save landing between a read
 * and a would-be write here could otherwise get silently clobbered by stale seeded data written after
 * it (getConfig/this function's predecessor never wrote on read either). The seed only actually
 * persists the first time an admin saves, which round-trips the whole computed tree back through the
 * normal save path regardless of whether anyone ever merely viewed the Admin page first. The same
 * no-write-on-read rule applies to migrateChildrenShape below: an old-shaped stored tree is upgraded
 * in memory only, not written back here.
 */
export async function getQuestionRoot(env: Env): Promise<QuestionRoot> {
  const stored = await env.CONFIG_KV.get<QuestionRoot>("config:question-root", "json");
  if (stored) {
    return {
      ...stored,
      yes: migrateFollowupPromptCategories(stored.yes),
      no: migrateFollowupPromptCategories(stored.no),
      children: migrateChildrenShape(stored.children),
    };
  }

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

/**
 * No write-on-read, same convention as getQuestionRoot. A stored blob from before the single
 * streakThreshold split into 4 (categoryYes/categoryNo/generalYes/generalNo) is migrated in memory —
 * an admin's already-tuned threshold is real data, so it's carried into all 4 new slots rather than
 * reset to the default, mechanically lossless (same trigger behavior until deliberately split apart).
 */
export async function getTriggerConfig(env: Env): Promise<TriggerConfig> {
  const stored = await env.CONFIG_KV.get<TriggerConfig>("config:triggers", "json");
  if (!stored) return DEFAULT_TRIGGERS;
  if ("categoryYesThreshold" in stored) return stored;

  const old = stored as unknown as { streakThreshold?: number; retireAfterDays?: number };
  const legacy = old.streakThreshold ?? DEFAULT_TRIGGERS.categoryYesThreshold;
  return {
    categoryYesThreshold: legacy,
    categoryNoThreshold: legacy,
    generalYesThreshold: legacy,
    generalNoThreshold: legacy,
    retireAfterDays: old.retireAfterDays ?? DEFAULT_TRIGGERS.retireAfterDays,
  };
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
