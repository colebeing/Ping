import type { AnswerRecord, BlockId, Category, Env, UserRecord } from "../types";
import { CATEGORIES } from "../types";
import { json } from "../http";
import { getState } from "../state";

export interface AnalyticsUserSummary {
  email: string;
  createdAt: string;
  totalAnswers: number;
  lastActive: string | null;
  activeDayStreak: number;
  topCategory: Category | null;
}

export interface AnalyticsResponse {
  totals: { userCount: number; answerCount: number; activeUsers7d: number; activeUsers30d: number };
  categoryTotals: Record<Category, number>;
  answerBalance: Record<BlockId, { yes: number; no: number }>;
  dailyActivity: { date: string; count: number }[];
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

  const categoryTotals: Record<Category, number> = { friends: 0, work: 0, home: 0, capacity: 0 };
  const answerBalance: Record<BlockId, { yes: number; no: number }> = {
    "1": { yes: 0, no: 0 },
    "2": { yes: 0, no: 0 },
    combined: { yes: 0, no: 0 },
  };
  const dailyCounts = new Map<string, number>();
  const users: AnalyticsUserSummary[] = [];
  let answerCount = 0;
  let activeUsers7d = 0;
  let activeUsers30d = 0;

  for (const userId of userIds) {
    const [user, state] = await Promise.all([env.STATE_KV.get<UserRecord>(`user:${userId}`, "json"), getState(env, userId)]);
    if (!user) continue;

    let lastActive: string | null = null;
    const catCounts: Record<Category, number> = { friends: 0, work: 0, home: 0, capacity: 0 };

    for (const a of state.answers) {
      answerCount++;
      answerBalance[a.block][a.answer]++;
      if (a.category) {
        categoryTotals[a.category]++;
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
      email: user.email,
      createdAt: user.createdAt,
      totalAnswers: state.answers.length,
      lastActive,
      activeDayStreak: activeDayStreak(state.answers, todayStr),
      topCategory,
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
    users,
  };
  return json(response);
}
