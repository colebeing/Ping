import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";
import { checkAndNotifyUser, computeNextAlarmTime } from "./push";

/**
 * One instance per user (named by userId via idFromName). Replaces the
 * Cron-Trigger-based sweep, which turned out to not execute at all on this
 * account despite being correctly configured on both the API and dashboard —
 * Durable Object alarms are a separate Cloudflare primitive, set per-user for
 * an exact instant, and don't depend on that broken scheduling path.
 */
export class PushScheduler extends DurableObject<Env> {
  async scheduleFor(userId: string): Promise<void> {
    await this.ctx.storage.put("userId", userId);
    const next = await computeNextAlarmTime(this.env, userId);
    if (next) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const userId = await this.ctx.storage.get<string>("userId");
    if (!userId) return;
    await checkAndNotifyUser(this.env, userId);
    await this.scheduleFor(userId);
  }
}

/** Call whenever a user's cadence or push subscriptions change, so their alarm reflects the new schedule. */
export async function scheduleUserPush(env: Env, userId: string): Promise<void> {
  const id = env.PUSH_SCHEDULER.idFromName(userId);
  const stub = env.PUSH_SCHEDULER.get(id);
  await stub.scheduleFor(userId);
}
