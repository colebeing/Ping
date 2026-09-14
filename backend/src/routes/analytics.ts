import type { Answer, AnswerRecord, BlockId, Category, Env, NotificationEvent, QuestionOverride, UserRecord } from "../types";
import { CATEGORIES } from "../types";
import { errorResponse, json } from "../http";
import { getState } from "../state";

export interface AnalyticsUserSummary {
  /** The raw KV user id (an email or "anon:<uuid>") — not shown, just the key for drilling into
   * handleGetUserProfile below. */
  id: string;
  email: string | null;
  createdAt: string;
  totalAnswers: number;
  lastActive: string | null;
  activeDayStreak: number;
  topCategory: Category | null;
  /** Most recent send attempt (sent or failed — "clicked" isn't a delivery outcome), so a silently-failing device shows up here instead of only being discoverable by reading raw state. */
  lastNotification: { block: BlockId; channel: NotificationEvent["channel"]; outcome: "sent" | "failed"; timestamp: string } | null;
}

export interface AnalyticsResponse {
  totals: { userCount: number; answerCount: number; activeUsers7d: number; activeUsers30d: number };
  categoryTotals: Record<Category, { yes: number; no: number }>;
  answerBalance: Record<BlockId, { yes: number; no: number }>;
  dailyActivity: { date: string; count: number }[];
  /** Send attempts (not clicks) across all users in the last 30 days — a delivery-health signal independent of any one user's history. */
  notificationTotals: { sent30d: number; failed30d: number };
  users: AnalyticsUserSummary[];
}

/** Builds a fresh Record<Category, T> from CATEGORIES instead of spelling out all four keys by hand —
 * `make` runs once per category so each gets its own object, not a shared reference. */
function zeroPerCategory<T>(make: () => T): Record<Category, T> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, make()])) as Record<Category, T>;
}

async function listUserIds(env: Env): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STATE_KV.list({ prefix: "user:", cursor });
    for (const key of page.keys) ids.push(key.name.slice("user:".length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

/** Consecutive days (ending today or yesterday, so an unfinished today doesn't zero out yesterday's run) with at least one answer recorded. */
function activeDayStreak(answers: AnswerRecord[], todayStr: string): number {
  const days = new Set(answers.map((a) => a.date));
  const stepBack = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

  let cursor = days.has(todayStr) ? todayStr : stepBack(todayStr);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = stepBack(cursor);
  }
  return streak;
}

export async function handleGetAnalytics(_request: Request, env: Env): Promise<Response> {
  const userIds = await listUserIds(env);
  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const categoryTotals: Record<Category, { yes: number; no: number }> = zeroPerCategory(() => ({ yes: 0, no: 0 }));
  const answerBalance: Record<BlockId, { yes: number; no: number }> = {
    "1": { yes: 0, no: 0 },
    "2": { yes: 0, no: 0 },
    combined: { yes: 0, no: 0 },
    q1: { yes: 0, no: 0 },
    q2: { yes: 0, no: 0 },
    q3: { yes: 0, no: 0 },
    q4: { yes: 0, no: 0 },
  };
  const dailyCounts = new Map<string, number>();
  const users: AnalyticsUserSummary[] = [];
  let answerCount = 0;
  let activeUsers7d = 0;
  let activeUsers30d = 0;
  let sent30d = 0;
  let failed30d = 0;
  const cutoff30Iso = new Date(Date.now() - 30 * 86400000).toISOString();

  for (const userId of userIds) {
    const [user, state] = await Promise.all([env.STATE_KV.get<UserRecord>(`user:${userId}`, "json"), getState(env, userId)]);
    if (!user) continue;

    let lastActive: string | null = null;
    const catCounts: Record<Category, number> = zeroPerCategory(() => 0);

    let lastNotification: AnalyticsUserSummary["lastNotification"] = null;
    for (const event of state.notificationEvents) {
      if (event.kind === "clicked") continue;
      if (event.timestamp >= cutoff30Iso) {
        if (event.kind === "sent") sent30d++;
        else failed30d++;
      }
      if (!lastNotification || event.timestamp > lastNotification.timestamp) {
        lastNotification = { block: event.block, channel: event.channel, outcome: event.kind, timestamp: event.timestamp };
      }
    }

    for (const a of state.answers) {
      answerCount++;
      answerBalance[a.block][a.answer]++;
      // Guard against stale category values from before a category rename —
      // an old AnswerRecord (e.g. a pre-rename "work"/"home") isn't a key in
      // these maps, and would otherwise throw and take down analytics for
      // every user over one old record from any single account.
      if (a.category && categoryTotals[a.category]) {
        categoryTotals[a.category][a.answer]++;
        catCounts[a.category]++;
      }
      dailyCounts.set(a.date, (dailyCounts.get(a.date) ?? 0) + 1);
      if (!lastActive || a.date > lastActive) lastActive = a.date;
    }

    if (lastActive && lastActive >= cutoff7) activeUsers7d++;
    if (lastActive && lastActive >= cutoff30) activeUsers30d++;

    let topCategory: Category | null = null;
    let topCount = 0;
    for (const cat of CATEGORIES) {
      if (catCounts[cat] > topCount) {
        topCount = catCounts[cat];
        topCategory = cat;
      }
    }

    users.push({
      id: userId,
      email: user.email ?? null,
      createdAt: user.createdAt,
      totalAnswers: state.answers.length,
      lastActive,
      activeDayStreak: activeDayStreak(state.answers, todayStr),
      topCategory,
      lastNotification,
    });
  }

  users.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  const dailyActivity = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { date, count: dailyCounts.get(date) ?? 0 };
  });

  const response: AnalyticsResponse = {
    totals: { userCount: userIds.length, answerCount, activeUsers7d, activeUsers30d },
    categoryTotals,
    answerBalance,
    dailyActivity,
    notificationTotals: { sent30d, failed30d },
    users,
  };
  return json(response);
}

export interface UserProfileResponse {
  email: string | null;
  createdAt: string;
  timezone: string;
  totalAnswers: number;
  activeDayStreak: number;
  /** The account's current routine question, if a swap invite has been accepted — same denormalized
   * per-block text QuestionOverride already carries, no tree lookup needed. */
  activeQuestion: { text: Record<string, string>; category: Category | null; acceptedAt: string } | null;
  /** yes/no counts per category, this 14-day window vs the previous one, plus all-time — lets the admin
   * read a direction themselves rather than trusting a synthesized trend score over a small sample. */
  categoryTrend: Record<Category, { last14: { yes: number; no: number }; prior14: { yes: number; no: number }; allTime: { yes: number; no: number } }>;
  /** What this user has actually accepted, most recent first — shows which content changes actually
   * landed, not just what was offered. No distinct "retired at" timestamp exists in the data (only
   * acceptedAt is ever recorded), so retirement is a status, not a date. */
  overrideHistory: { question: string; category: Category | null; valence: "amplify" | "resolve"; acceptedAt: string; status: "active" | "retired" }[];
  /** Last 20 answers, most recent first, for literally scanning recent behavior. */
  recentAnswers: { date: string; block: BlockId; answer: Answer; category: Category | null }[];
}

function emptyCategoryTrend(): UserProfileResponse["categoryTrend"] {
  const empty = () => ({ yes: 0, no: 0 });
  return zeroPerCategory(() => ({ last14: empty(), prior14: empty(), allTime: empty() }));
}

/** Denormalizes an override's 4-block question into one representative string for a human-scannable
 * history list — overrideHistory isn't the tree editor, it doesn't need the full per-block shape. */
function overrideQuestionSummary(override: QuestionOverride): string {
  return override.blockQuestions.q1 || Object.values(override.blockQuestions).find((q) => q) || "(no question text)";
}

/** Valence isn't stored directly on QuestionOverride — it's the last step of the path that produced it. */
function overrideValence(override: QuestionOverride): "amplify" | "resolve" {
  return override.path[override.path.length - 1]?.valence ?? "amplify";
}

export async function handleGetUserProfile(_request: Request, env: Env, id: string): Promise<Response> {
  const user = await env.STATE_KV.get<UserRecord>(`user:${id}`, "json");
  if (!user) return errorResponse("User not found", 404);
  const state = await getState(env, id);

  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const cutoff28 = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);

  const categoryTrend = emptyCategoryTrend();
  for (const a of state.answers) {
    // Guard against stale category values from before a category rename, same as handleGetAnalytics.
    if (!a.category || !categoryTrend[a.category]) continue;
    const bucket = categoryTrend[a.category];
    bucket.allTime[a.answer]++;
    if (a.date >= cutoff14) bucket.last14[a.answer]++;
    else if (a.date >= cutoff28) bucket.prior14[a.answer]++;
  }

  const overrideHistory: UserProfileResponse["overrideHistory"] = [
    ...(state.activeOverride
      ? [
          {
            question: overrideQuestionSummary(state.activeOverride),
            category: state.activeOverride.category,
            valence: overrideValence(state.activeOverride),
            acceptedAt: state.activeOverride.acceptedAt,
            status: "active" as const,
          },
        ]
      : []),
    ...state.retiredOverrides.map((o) => ({
      question: overrideQuestionSummary(o),
      category: o.category,
      valence: overrideValence(o),
      acceptedAt: o.acceptedAt,
      status: "retired" as const,
    })),
  ].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));

  const recentAnswers = [...state.answers]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 20)
    .map((a) => ({ date: a.date, block: a.block, answer: a.answer, category: a.category ?? null }));

  const response: UserProfileResponse = {
    email: user.email ?? null,
    createdAt: user.createdAt,
    timezone: state.cadence.timezone,
    totalAnswers: state.answers.length,
    activeDayStreak: activeDayStreak(state.answers, todayStr),
    activeQuestion: state.activeOverride
      ? { text: state.activeOverride.blockQuestions, category: state.activeOverride.category, acceptedAt: state.activeOverride.acceptedAt }
      : null,
    categoryTrend,
    overrideHistory,
    recentAnswers,
  };
  return json(response);
}
