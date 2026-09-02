import { buildPushPayload, type PushMessage, type PushSubscription as WebPushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import type { BlockId, Cadence, Env, PushSubscriptionJSON } from "./types";
import { getState, saveState, todayLocal } from "./state";
import { sendFcmPush, type SendOutcome } from "./fcm";

/** Which block(s) are actually live for this user's current cadence, and what time each is due. "once" collapses to a single "combined" block using block1's time slot; "four" expands to four independent blocks using block1-4. */
function activeBlockTimes(cadence: Cadence): { block: BlockId; time: string }[] {
  if (cadence.frequency === "once") return [{ block: "combined", time: cadence.block1 }];
  if (cadence.frequency === "four") {
    return [
      { block: "q1", time: cadence.block1 },
      { block: "q2", time: cadence.block2 },
      { block: "q3", time: cadence.block3 ?? cadence.block1 },
      { block: "q4", time: cadence.block4 ?? cadence.block2 },
    ];
  }
  return [
    { block: "1", time: cadence.block1 },
    { block: "2", time: cadence.block2 },
  ];
}

function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}

export async function sendPush(env: Env, subscription: PushSubscriptionJSON, message: PushMessage): Promise<SendOutcome> {
  const keys = vapidKeys(env);
  if (!keys) return "failed";
  try {
    const payload = await buildPushPayload(message, subscription as WebPushSubscription, keys);
    const res = await fetch(subscription.endpoint, payload);
    if (res.status === 201) return "sent";
    // 404/410 means the push service considers this subscription permanently
    // gone (expired/unsubscribed) — not a transient failure worth retrying.
    if (res.status === 404 || res.status === 410) return "gone";
    console.error("push send rejected", res.status, subscription.endpoint);
    return "failed";
  } catch (err) {
    console.error("push send failed", err);
    return "failed";
  }
}

const BLOCK_PROMPTS: Record<BlockId, string> = {
  "1": "Did today start how you wanted?",
  "2": "Did today end how you wanted?",
  combined: "Did today go how you wanted?",
  q1: "Did today start how you wanted?",
  q2: "Did this morning go how you wanted?",
  q3: "Did this afternoon go how you wanted?",
  q4: "Did today end how you wanted?",
};

function blockPushBody(state: Awaited<ReturnType<typeof getState>>, block: BlockId): string {
  const override = state.activeOverrides[block];
  return override ? `Did ${override.when} ${override.how}?` : BLOCK_PROMPTS[block];
}

/**
 * Sends to every device this user has registered, and mutates `state` in
 * place: logs a NotificationEvent per attempt (for delivery-rate analytics)
 * and drops any subscription/token the push service reports as permanently
 * gone, so a long-dead device doesn't linger forever and doesn't mask real
 * failures behind "at least one succeeded" logic.
 *
 * Returns whether at least one device actually accepted the push.
 */
async function sendBlockPush(env: Env, state: Awaited<ReturnType<typeof getState>>, block: BlockId): Promise<boolean> {
  const body = blockPushBody(state, block);
  let anySent = false;

  const survivingSubs: PushSubscriptionJSON[] = [];
  for (const sub of state.pushSubscriptions) {
    const outcome = await sendPush(env, sub, { data: JSON.stringify({ title: "Ping", body, block }), options: { ttl: 3600 } });
    state.notificationEvents.push({ block, kind: outcome === "sent" ? "sent" : "failed", channel: "webpush", timestamp: new Date().toISOString() });
    if (outcome === "sent") anySent = true;
    if (outcome !== "gone") survivingSubs.push(sub);
  }
  state.pushSubscriptions = survivingSubs;

  // Data-only, not a `notification` payload — the native app's own FirebaseMessagingService builds the
  // interactive, swap-in-place notification itself rather than letting Android auto-display a plain one.
  const survivingTokens: string[] = [];
  for (const token of state.fcmTokens) {
    const outcome = await sendFcmPush(env, token, { title: "Ping", body, block });
    state.notificationEvents.push({ block, kind: outcome === "sent" ? "sent" : "failed", channel: "fcm", timestamp: new Date().toISOString() });
    if (outcome === "sent") anySent = true;
    if (outcome !== "gone") survivingTokens.push(token);
  }
  state.fcmTokens = survivingTokens;

  return anySent;
}

/** Called from the service worker's notificationclick — logs the tap itself, distinct from whether it went on to record an answer, so delivery and interaction can be measured separately. */
export async function recordNotificationClicked(env: Env, userId: string, block: BlockId): Promise<void> {
  const state = await getState(env, userId);
  state.notificationEvents.push({ block, kind: "clicked", channel: "webpush", timestamp: new Date().toISOString() });
  await saveState(env, userId, state);
}

/**
 * Called by a user's PushScheduler Durable Object when its alarm fires.
 * Sends any block whose cadence is due right now (within a small tolerance,
 * in case the alarm landed a little early/late) and hasn't been sent today.
 */
export async function checkAndNotifyUser(env: Env, userId: string): Promise<void> {
  if (!vapidKeys(env)) return; // no secrets configured yet — no-op until deployed

  const state = await getState(env, userId);
  if (state.pushSubscriptions.length === 0) return;

  const today = todayLocal(state.cadence.timezone);
  let changed = false;

  for (const { block, time } of activeBlockTimes(state.cadence)) {
    if (state.lastNotified[block] === today) continue;
    if (!isDueNow(time, state.cadence.timezone)) continue;

    await sendBlockPush(env, state, block);
    state.lastNotified[block] = today;
    changed = true;
  }

  if (changed) await saveState(env, userId, state);
}

/** On-demand send for testing — ignores cadence/lastNotified entirely. */
export async function sendTestPush(env: Env, userId: string, block: BlockId): Promise<{ ok: boolean; reason?: string }> {
  if (!vapidKeys(env)) return { ok: false, reason: "Push isn't configured on the server (missing VAPID secrets)" };
  const state = await getState(env, userId);
  if (state.pushSubscriptions.length === 0 && state.fcmTokens.length === 0) {
    return { ok: false, reason: "No push subscription on this device yet" };
  }
  const sent = await sendBlockPush(env, state, block);
  await saveState(env, userId, state);
  if (!sent) return { ok: false, reason: "The push service rejected it — try disabling and re-enabling notifications on this device" };
  return { ok: true };
}

/** Epoch ms of the soonest upcoming block cadence for this user, or null if they have no push subscriptions. */
export async function computeNextAlarmTime(env: Env, userId: string): Promise<number | null> {
  const state = await getState(env, userId);
  if (state.pushSubscriptions.length === 0) return null;

  const now = new Date();
  const times = activeBlockTimes(state.cadence).map(({ time }) => nextOccurrence(time, state.cadence.timezone, now));
  return Math.min(...times.map((d) => d.getTime()));
}

// Small tolerance so a slightly-early/late alarm firing still counts as due;
// lastNotified still caps delivery to once per block per day regardless.
const DUE_WINDOW_MINUTES = 3;

function isDueNow(cadenceHHMM: string, timezone: string): boolean {
  const diff = (currentMinutesInTz(timezone) - cadenceMinutes(cadenceHHMM) + 1440) % 1440;
  return diff < DUE_WINDOW_MINUTES;
}

function currentMinutesInTz(timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hh * 60 + mm;
}

function cadenceMinutes(cadenceHHMM: string): number {
  const [hh, mm] = cadenceHHMM.split(":").map(Number);
  return (hh % 24) * 60 + (mm || 0);
}

/** What UTC instant does `timezone`'s local clock differ from UTC by, evaluated near `atUtc`? (minutes, e.g. -240 for EDT) */
function tzOffsetMinutes(timezone: string, atUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(atUtc);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - atUtc.getTime()) / 60000;
}

function wallClockDateInTz(timezone: string, atUtc: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(atUtc);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

function utcForWallClock(timezone: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = tzOffsetMinutes(timezone, new Date(guess));
  return new Date(guess - offset * 60000);
}

/** Next UTC instant this cadence (HH:MM, per-user timezone) occurs, strictly after `after`. */
function nextOccurrence(cadenceHHMM: string, timezone: string, after: Date): Date {
  const [hh, mm] = cadenceHHMM.split(":").map(Number);
  const { y, m, d } = wallClockDateInTz(timezone, after);
  let candidate = utcForWallClock(timezone, y, m, d, hh, mm);
  if (candidate.getTime() <= after.getTime()) {
    const tomorrow = new Date(after.getTime() + 24 * 60 * 60 * 1000);
    const t = wallClockDateInTz(timezone, tomorrow);
    candidate = utcForWallClock(timezone, t.y, t.m, t.d, hh, mm);
  }
  return candidate;
}
