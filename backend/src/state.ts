import type { Env, UserState } from "./types";

export function defaultState(): UserState {
  return {
    pathCounts: {},
    categoryCounts: { friends: 0, colleagues: 0, family: 0, me: 0 },
    answers: [],
    answerEdits: [],
    activeOverrides: {},
    retiredOverrides: [],
    pendingNudges: [],
    declinedStreaks: {},
    totalFollowupsAnswered: 0,
    cadence: { block1: "11:00", block2: "23:00", timezone: "UTC", frequency: "twice" },
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
  if (!stored.cadence.frequency) stored.cadence.frequency = "twice";
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
    stored.activeOverrides = {};
    stored.retiredOverrides = [];
    stored.pendingNudges = [];
  }
  // Recommendations used to carry a plain "suggestedHow" string and overrides
  // had no yes/no follow-ups of their own (they borrowed the block's) — old-shape
  // entries can't be salvaged piecemeal, so drop just those, not the whole state.
  if (Object.values(stored.activeOverrides).some((o) => o && !("yes" in o))) stored.activeOverrides = {};
  if (stored.retiredOverrides.some((o) => !("yes" in o))) stored.retiredOverrides = [];
  stored.pendingNudges = stored.pendingNudges.filter((n) => n.kind !== "recommendation" || "invitation" in n);
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
