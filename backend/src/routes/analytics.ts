import type { AnswerRecord, BlockId, Category, Env, NotificationEvent, UserRecord } from "../types";
import { CATEGORIES } from "../types";
import { json } from "../http";
import { getState } from "../state";

export interface AnalyticsUserSummary {
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

  const categoryTotals: Record<Category, { yes: number; no: number }> = {
    friends: { yes: 0, no: 0 },
    colleagues: { yes: 0, no: 0 },
    family: { yes: 0, no: 0 },
    me: { yes: 0, no: 0 },
  };
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
    const catCounts: Record<Category, number> = { friends: 0, colleagues: 0, family: 0, me: 0 };

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
