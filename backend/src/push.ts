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

/** Called from the hourly scheduled handler. Sends to any user whose cadence matches the current local hour and hasn't been notified yet today for that block. */
export async function runHourlyPushSweep(env: Env): Promise<void> {
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
      if (!isDueThisHour(cadenceTime, state.cadence.timezone)) continue;

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

function isDueThisHour(cadenceHHMM: string, timezone: string): boolean {
  const [hh] = cadenceHHMM.split(":");
  const nowHour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).format(new Date());
  return parseInt(nowHour, 10) % 24 === parseInt(hh, 10) % 24;
}
