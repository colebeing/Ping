import { buildPushPayload, type PushMessage, type PushSubscription as WebPushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import type { BlockId, Env, PushSubscriptionJSON } from "./types";
import { getState, saveState, todayLocal } from "./state";

function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}

export async function sendPush(env: Env, subscription: PushSubscriptionJSON, message: PushMessage): Promise<boolean> {
  const keys = vapidKeys(env);
  if (!keys) return false;
  try {
    const payload = await buildPushPayload(message, subscription as WebPushSubscription, keys);
    const res = await fetch(subscription.endpoint, payload);
    return res.status === 201;
  } catch (err) {
    console.error("push send failed", err);
    return false;
  }
}

const BLOCK_PROMPTS: Record<BlockId, string> = {
  "1": "Did today start how you wanted?",
  "2": "Did today end how you wanted?",
};

/** Called from the once-a-minute scheduled handler. Sends to any user whose cadence matches the current local time (within a small tolerance window) and hasn't been notified yet today for that block. */
export async function runPushSweep(env: Env): Promise<void> {
  if (!vapidKeys(env)) return; // no secrets configured yet — no-op until deployed

  const list = await env.STATE_KV.list({ prefix: "state:" });
  for (const key of list.keys) {
    const userId = key.name.slice("state:".length);
    const state = await getState(env, userId);
    let changed = false;

    for (const block of ["1", "2"] as BlockId[]) {
      const cadenceTime = block === "1" ? state.cadence.block1 : state.cadence.block2;
      const today = todayLocal(state.cadence.timezone);
      if (state.lastNotified[block] === today) continue;
      if (!isDueNow(cadenceTime, state.cadence.timezone)) continue;

      const override = state.activeOverrides[block];
      const body = override ? `Did ${override.when} ${override.how}?` : BLOCK_PROMPTS[block];

      for (const sub of state.pushSubscriptions) {
        await sendPush(env, sub, { data: JSON.stringify({ title: "Ping", body }), options: { ttl: 3600 } });
      }
      state.lastNotified[block] = today;
      changed = true;
    }

    if (changed) await saveState(env, userId, state);
  }
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

// Tolerance window so a delayed/missed minute-tick doesn't silently skip a
// user's notification for the whole day; lastNotified still caps it to one send.
const DUE_WINDOW_MINUTES = 5;

function isDueNow(cadenceHHMM: string, timezone: string): boolean {
  const diff = (currentMinutesInTz(timezone) - cadenceMinutes(cadenceHHMM) + 1440) % 1440;
  return diff < DUE_WINDOW_MINUTES;
}
