import type { Env, UserState } from "./types";

export function defaultState(): UserState {
  return {
    pathCounts: {},
    categoryCounts: { friends: 0, work: 0, home: 0, capacity: 0 },
    answers: [],
    activeOverrides: {},
    retiredOverrides: [],
    pendingRecommendations: [],
    cadence: { block1: "11:00", block2: "23:00", timezone: "UTC" },
    pushSubscriptions: [],
    lastNotified: {},
  };
}

export async function getState(env: Env, userId: string): Promise<UserState> {
  const stored = await env.STATE_KV.get<UserState>(`state:${userId}`, "json");
  return stored ?? defaultState();
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
