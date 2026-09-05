import { buildPushPayload, type PushMessage, type PushSubscription as WebPushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import { LIVE_BLOCKS, isLiveBlockId, type BlockId, type Cadence, type Env, type LiveBlockId, type PushSubscriptionJSON } from "./types";
import { getState, saveState, todayLocal } from "./state";
import { sendFcmPush, type SendOutcome } from "./fcm";

/** Which of q1-q4 are actually live for this user right now (not skipped), and what time each is due. */
function activeBlockTimes(cadence: Cadence): { block: LiveBlockId; time: string }[] {
  return LIVE_BLOCKS.filter((b) => !cadence.skippedBlocks.includes(b)).map((b) => ({ block: b, time: cadence.times[b] }));
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
  // The account's single active override (if any) applies across all four live blocks — irrelevant to
  // a legacy block, which never had one.
  if (isLiveBlockId(block) && state.activeOverride) return state.activeOverride.blockQuestions[block];
  return BLOCK_PROMPTS[block];
}

interface PushOutcome {
  anySent: boolean;
  webpush: { sub: PushSubscriptionJSON; outcome: SendOutcome }[];
  fcm: { token: string; outcome: SendOutcome }[];
}

/**
 * Sends to every device passed in. Deliberately takes plain snapshots (not a mutable `state`
 * reference) and returns outcomes rather than saving anything itself — each send is a network round
 * trip, so holding a `state` object mutable across all of them and saving afterward left a long
 * window where a concurrent request (e.g. the app registering a device) could read state, save its
 * own change, and then get silently overwritten when this function's stale copy saved last. See
 * applyPushOutcome, which re-reads fresh state right before the (much shorter) save.
 */
async function sendBlockPush(
  env: Env,
  body: string,
  block: BlockId,
  subs: PushSubscriptionJSON[],
  tokens: string[],
): Promise<PushOutcome> {
  const webpush: { sub: PushSubscriptionJSON; outcome: SendOutcome }[] = [];
  for (const sub of subs) {
    const outcome = await sendPush(env, sub, { data: JSON.stringify({ title: "Ping", body, block }), options: { ttl: 3600 } });
    webpush.push({ sub, outcome });
  }

  // Data-only, not a `notification` payload — the native app's own FirebaseMessagingService builds the
  // interactive, swap-in-place notification itself rather than letting Android auto-display a plain one.
  const fcm: { token: string; outcome: SendOutcome }[] = [];
  for (const token of tokens) {
    const outcome = await sendFcmPush(env, token, { title: "Ping", body, block });
    fcm.push({ token, outcome });
  }

  const anySent = webpush.some((w) => w.outcome === "sent") || fcm.some((f) => f.outcome === "sent");
  return { anySent, webpush, fcm };
}

/**
 * Applies a sendBlockPush result against freshly-read state: prunes any subscription/token the push
 * service reported as permanently gone, logs a NotificationEvent per attempt, and — only when
 * `markNotifiedIfSent` and at least one device actually accepted the push — marks the block notified
 * for today. Marking on a genuine failure would hide it from analytics forever (nothing else ever
 * flips it back), which is worse than leaving lastNotified alone.
 */
async function applyPushOutcome(env: Env, userId: string, block: BlockId, result: PushOutcome, markNotifiedIfSent: boolean): Promise<void> {
  const state = await getState(env, userId);

  const goneEndpoints = new Set(result.webpush.filter((w) => w.outcome === "gone").map((w) => w.sub.endpoint));
  state.pushSubscriptions = state.pushSubscriptions.filter((s) => !goneEndpoints.has(s.endpoint));
  for (const { outcome } of result.webpush) {
    state.notificationEvents.push({ block, kind: outcome === "sent" ? "sent" : "failed", channel: "webpush", timestamp: new Date().toISOString() });
  }

  const goneTokens = new Set(result.fcm.filter((f) => f.outcome === "gone").map((f) => f.token));
  state.fcmTokens = state.fcmTokens.filter((t) => !goneTokens.has(t));
  for (const { outcome } of result.fcm) {
    state.notificationEvents.push({ block, kind: outcome === "sent" ? "sent" : "failed", channel: "fcm", timestamp: new Date().toISOString() });
  }

  if (markNotifiedIfSent && result.anySent) state.lastNotified[block] = todayLocal(state.cadence.timezone);

  await saveState(env, userId, state);
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
  if (state.pushSubscriptions.length === 0 && state.fcmTokens.length === 0) return;

  const today = todayLocal(state.cadence.timezone);

  for (const { block, time } of activeBlockTimes(state.cadence)) {
    if (state.lastNotified[block] === today) continue;
    if (!isDueNow(time, state.cadence.timezone)) continue;
    // Already answered (e.g. filled in early via the app) — nothing left to
    // interrupt for, so sending would just be noise.
    if (state.answers.some((a) => a.date === today && a.block === block)) continue;

    const body = blockPushBody(state, block);
    const result = await sendBlockPush(env, body, block, state.pushSubscriptions, state.fcmTokens);
    await applyPushOutcome(env, userId, block, result, /* markNotifiedIfSent */ true);
  }
}

/** On-demand send for testing — ignores cadence/lastNotified entirely, and never marks the block notified. */
export async function sendTestPush(env: Env, userId: string, block: BlockId): Promise<{ ok: boolean; reason?: string }> {
  if (!vapidKeys(env)) return { ok: false, reason: "Push isn't configured on the server (missing VAPID secrets)" };
  const state = await getState(env, userId);
  if (state.pushSubscriptions.length === 0 && state.fcmTokens.length === 0) {
    return { ok: false, reason: "No push subscription on this device yet" };
  }
  const body = blockPushBody(state, block);
  const result = await sendBlockPush(env, body, block, state.pushSubscriptions, state.fcmTokens);
  await applyPushOutcome(env, userId, block, result, /* markNotifiedIfSent */ false);
  if (!result.anySent) return { ok: false, reason: "The push service rejected it — try disabling and re-enabling notifications on this device" };
  return { ok: true };
}

/** Epoch ms of the soonest upcoming block cadence for this user, or null if they have no push subscriptions of any channel. */
export async function computeNextAlarmTime(env: Env, userId: string): Promise<number | null> {
  const state = await getState(env, userId);
  if (state.pushSubscriptions.length === 0 && state.fcmTokens.length === 0) return null;

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
