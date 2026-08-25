import type { Env, InviteToken } from "./types";
import { normalizeEmail } from "./auth";

const INVITE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createInvite(env: Env, email: string, invitedBy: string): Promise<string> {
  const token = crypto.randomUUID();
  const record: InviteToken = { email: normalizeEmail(email), invitedBy, expiresAt: Date.now() + INVITE_TTL_SECONDS * 1000 };
  await env.STATE_KV.put(`invite:${token}`, JSON.stringify(record), { expirationTtl: INVITE_TTL_SECONDS });
  return token;
}

/** Validates the token matches this email and hasn't expired, without consuming it (so a failed signup attempt doesn't burn the invite). */
export async function peekInvite(env: Env, token: string, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const record = await env.STATE_KV.get<InviteToken>(`invite:${token}`, "json");
  if (!record || record.expiresAt < Date.now()) return { ok: false, reason: "This invite is invalid or has expired" };
  if (record.email !== normalizeEmail(email)) return { ok: false, reason: "This invite was sent to a different email address" };
  return { ok: true };
}

export async function consumeInvite(env: Env, token: string): Promise<void> {
  await env.STATE_KV.delete(`invite:${token}`);
}
