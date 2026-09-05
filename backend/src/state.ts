import type { Env, LiveBlockId, UserState } from "./types";

// Four hours apart, clearing MIN_GAP_MINUTES's 2-hour spacing rule with room to spare. Shared between
// a brand-new account and the legacy-cadence migration below (for whichever slots a migrating user
// wasn't already using).
const DEFAULT_TIMES: Record<LiveBlockId, string> = { q1: "08:00", q2: "12:00", q3: "16:00", q4: "20:00" };

export function defaultState(): UserState {
  return {
    pathCounts: {},
    categoryCounts: { friends: 0, colleagues: 0, family: 0, me: 0 },
    answers: [],
    answerEdits: [],
    retiredOverrides: [],
    pendingNudges: [],
    declinedStreaks: {},
    totalFollowupsAnswered: 0,
    cadence: { times: { ...DEFAULT_TIMES }, skippedBlocks: [], timezone: "UTC" },
    pushSubscriptions: [],
    fcmTokens: [],
    lastNotified: {},
    notificationEvents: [],
    appOpenDates: [],
    deviceRegistrations: [],
  };
}

/** Whether this user has any device registered to actually receive a push, on either channel. */
export function hasPushEnabled(state: UserState): boolean {
  return state.pushSubscriptions.length > 0 || state.fcmTokens.length > 0;
}

export async function getState(env: Env, userId: string): Promise<UserState> {
  const stored = await env.STATE_KV.get<UserState>(`state:${userId}`, "json");
  if (!stored) return defaultState();
  // Backfills for state saved before a field existed.
  // Old three-frequency-mode cadence -> always-four-blocks-with-skips. Times a user was actually
  // using carry over exactly (same notification schedule going forward); slots they weren't using
  // get the standard defaults, inert since skipped. Escalation/streak bookkeeping tied to the old
  // block ids ("1"/"2"/"combined") is deliberately NOT migrated here — it just goes dormant, unlike
  // these user-authored times, which are worth preserving. A fresh object literal, not a mutation of
  // the old one, so the removed frequency/block1-4 keys don't silently survive and get re-persisted.
  if (!stored.cadence.times) {
    const old = stored.cadence as unknown as {
      frequency?: "once" | "twice" | "four";
      block1?: string;
      block2?: string;
      block3?: string;
      block4?: string;
      timezone: string;
    };
    const frequency = old.frequency ?? "twice"; // pre-frequency-field data defaulted to twice-daily
    let times: Record<LiveBlockId, string>;
    let skippedBlocks: LiveBlockId[];
    if (frequency === "four") {
      times = { q1: old.block1 ?? DEFAULT_TIMES.q1, q2: old.block2 ?? DEFAULT_TIMES.q2, q3: old.block3 ?? DEFAULT_TIMES.q3, q4: old.block4 ?? DEFAULT_TIMES.q4 };
      skippedBlocks = [];
    } else if (frequency === "once") {
      times = { q1: old.block1 ?? DEFAULT_TIMES.q1, q2: DEFAULT_TIMES.q2, q3: DEFAULT_TIMES.q3, q4: DEFAULT_TIMES.q4 };
      skippedBlocks = ["q2", "q3", "q4"];
    } else {
      times = { q1: old.block1 ?? DEFAULT_TIMES.q1, q2: DEFAULT_TIMES.q2, q3: DEFAULT_TIMES.q3, q4: old.block2 ?? DEFAULT_TIMES.q4 };
      skippedBlocks = ["q2", "q3"];
    }
    stored.cadence = { times, skippedBlocks, timezone: old.timezone };
  }
  if (!stored.fcmTokens) stored.fcmTokens = [];
  if (!stored.declinedStreaks) stored.declinedStreaks = {};
  if (!stored.answerEdits) stored.answerEdits = [];
  if (!stored.notificationEvents) stored.notificationEvents = [];
  if (!stored.appOpenDates) stored.appOpenDates = [];
  if (!stored.deviceRegistrations) stored.deviceRegistrations = [];
  if (!stored.totalFollowupsAnswered) stored.totalFollowupsAnswered = 0;
  // pendingRecommendations -> pendingNudges: every old entry is already a valid RecommendationNudge
  // once tagged with `kind` — mapped rather than dropped, so an invitation a user hasn't resolved yet
  // survives the migration instead of silently vanishing.
  if (!stored.pendingNudges) {
    const old = (stored as unknown as { pendingRecommendations?: unknown[] }).pendingRecommendations ?? [];
    stored.pendingNudges = old.map((r) => ({ ...(r as object), kind: "recommendation" as const })) as UserState["pendingNudges"];
  }
  // The WHY follow-up's category set changed (friends/work/home/capacity ->
  // friends/colleagues/family/me) and WHAT was dropped entirely — old
  // path/category counts and answer categories are no longer meaningful
  // under the new scheme, so a stale shape resets all answer history.
  if (!("colleagues" in stored.categoryCounts)) {
    stored.categoryCounts = { friends: 0, colleagues: 0, family: 0, me: 0 };
    stored.pathCounts = {};
    stored.answers = [];
    stored.activeOverride = undefined;
    stored.retiredOverrides = [];
    stored.pendingNudges = [];
  }
  // Overrides used to be per-block (activeOverrides: Partial<Record<BlockId, QuestionOverride>>) —
  // accepting a swap invite now changes the routine question on all four blocks at once, so there's a
  // single activeOverride instead. A per-block record can't be salvaged into one global value (no
  // principled way to pick a winner across blocks), so it's dropped like every other genuinely
  // incompatible shape below, not guessed at.
  if ("activeOverrides" in stored) {
    delete (stored as unknown as { activeOverrides?: unknown }).activeOverrides;
    stored.activeOverride = undefined;
  }
  // Recommendations used to carry a plain "suggestedHow" string and overrides
  // had no yes/no follow-ups of their own (they borrowed the block's) — old-shape
  // entries can't be salvaged piecemeal, so drop just those, not the whole state.
  if (stored.activeOverride && !("yes" in stored.activeOverride)) stored.activeOverride = undefined;
  if (stored.retiredOverrides.some((o) => !("yes" in o))) stored.retiredOverrides = [];
  // Every override shape before the escalation tree (including the immediately-prior when/how->question
  // flatten's own output) lacks `path` — valence was never stored on a QuestionOverride before now, so
  // there's no way to reconstruct which tree path produced it. Dropped the same way the check just
  // above drops other genuinely-incompatible override shapes, not guessed at.
  if (stored.activeOverride && !("path" in stored.activeOverride)) stored.activeOverride = undefined;
  if (stored.retiredOverrides.some((o) => !("path" in o))) stored.retiredOverrides = [];
  // Escalation nodes used to carry one flat, block-agnostic `question` string — an override built from
  // one lacks `blockQuestions` (the new per-block shape) and can't be salvaged (there's no way to
  // reconstruct 4 timed phrasings from 1 flat string), so it's dropped the same way.
  if (stored.activeOverride && !("blockQuestions" in stored.activeOverride)) stored.activeOverride = undefined;
  if (stored.retiredOverrides.some((o) => !("blockQuestions" in o))) stored.retiredOverrides = [];
  // A pending (not-yet-accepted) recommendation snapshots its own path/node at creation time — an
  // old-shaped one (carrying `invitation` instead, or a `node` built before the blockQuestions split)
  // can't be salvaged (there's no tree to resolve it against retroactively), so it's dropped like any
  // other genuinely incompatible pending-nudge shape: transient, low-stakes state — detectStreaks
  // naturally re-proposes the same pattern if it continues.
  stored.pendingNudges = stored.pendingNudges.filter(
    (n) => n.kind !== "recommendation" || ("path" in n && "node" in n && "blockQuestions" in n.node),
  );
  return stored;
}

export async function saveState(env: Env, userId: string, state: UserState): Promise<void> {
  await env.STATE_KV.put(`state:${userId}`, JSON.stringify(state));
}

export function todayLocal(timezone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(at); // en-CA formats as YYYY-MM-DD
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Resolves a client-requested date for answering/viewing a block: defaults to today, and never allows the future (backfilling the past is fine, answering ahead isn't). */
export function resolveDate(timezone: string, requested?: string | null): string {
  const today = todayLocal(timezone);
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return today;
  return requested > today ? today : requested;
}
