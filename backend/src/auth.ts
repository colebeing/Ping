import type { DeviceTokenRecord, Env, PasswordResetToken, SessionRecord, UserRecord } from "./types";
import { getState, saveState } from "./state";

const PBKDF2_ITERATIONS = 100_000;
// Not the session's actual lifetime (it has none) — just the longest Max-Age a browser will honor
// on the cookie carrying it, per Chrome's ~400-day hard cap. Sending more than a browser accepts is
// harmless; it just clamps to its own ceiling instead of silently dropping the cookie shorter.
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const SESSION_COOKIE = "ping_session";

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function deriveHash(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt);
  return { hash, salt: toHex(salt.buffer as ArrayBuffer) };
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const computed = await deriveHash(password, fromHex(salt));
  if (computed.length !== hash.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const ANON_ID_PREFIX = "anon:";

/** Shared create-and-store step for every "brand new UserRecord" path below — the one place that
 * enforces "id must not already exist" so it can't drift between callers. */
async function putNewUserRecord(env: Env, id: string, extra: Partial<UserRecord> = {}): Promise<UserRecord> {
  const existing = await env.STATE_KV.get(`user:${id}`);
  if (existing) throw new Error("An account with that email already exists");
  const user: UserRecord = { id, createdAt: new Date().toISOString(), ...extra };
  await env.STATE_KV.put(`user:${id}`, JSON.stringify(user));
  return user;
}

export async function createUser(env: Env, email: string, password: string): Promise<UserRecord> {
  const id = normalizeEmail(email);
  const { hash, salt } = await hashPassword(password);
  return putNewUserRecord(env, id, { email: id, passwordHash: hash, salt });
}

export async function getUser(env: Env, email: string): Promise<UserRecord | null> {
  return env.STATE_KV.get<UserRecord>(`user:${normalizeEmail(email)}`, "json");
}

export async function createUserFromGoogle(env: Env, email: string): Promise<UserRecord> {
  const id = normalizeEmail(email);
  return putNewUserRecord(env, id, { email: id });
}

/** The zero-friction entry point — id doubles as its own normalized "email" for getUser's
 * re-normalization (already-lowercase strings are a no-op under .trim().toLowerCase()), so no
 * separate anonymous-lookup path is needed anywhere else in the codebase. */
export async function createAnonymousUser(env: Env): Promise<UserRecord> {
  return putNewUserRecord(env, `${ANON_ID_PREFIX}${crypto.randomUUID()}`);
}

/**
 * Migrates an unclaimed anonymous account onto a real, permanent identity keyed by normalized
 * email — the ONLY place a UserRecord's id ever changes after creation. Ordering matters: the new
 * records are written first, the old ones deleted only after — KV has no multi-key transactions, so
 * an interrupted migration's worst case is a harmless orphaned pre-claim record, never lost data.
 * Refuses a source account that already has an email — without that guard, hitting this by mistake
 * from an already-named session could silently reassign it onto a different email and delete its
 * real `user:`/`state:` records.
 */
export async function claimAccount(
  env: Env,
  fromId: string,
  email: string,
  credentials: { passwordHash: string; salt: string } | null,
): Promise<UserRecord> {
  const fromUser = await getUser(env, fromId);
  if (!fromUser) throw new Error("Account not found");
  if (fromUser.email) throw new Error("This account already has an email saved");

  const id = normalizeEmail(email);
  if (await env.STATE_KV.get(`user:${id}`)) throw new Error("An account with that email already exists");

  const fromState = await getState(env, fromId); // whole-object copy, so pendingNudges/activeOverride/etc. all carry over untouched
  const claimed: UserRecord = { ...fromUser, id, email: id, ...(credentials ?? {}) };
  await env.STATE_KV.put(`user:${id}`, JSON.stringify(claimed));
  await saveState(env, id, fromState);
  await env.STATE_KV.delete(`user:${fromId}`);
  await env.STATE_KV.delete(`state:${fromId}`);
  return claimed;
}

export async function setPassword(env: Env, userId: string, newPassword: string): Promise<void> {
  const user = await getUser(env, userId);
  if (!user) throw new Error("User not found");
  const { hash, salt } = await hashPassword(newPassword);
  const updated: UserRecord = { ...user, passwordHash: hash, salt };
  await env.STATE_KV.put(`user:${userId}`, JSON.stringify(updated));
}

/** Always succeeds from the caller's perspective, even for an unknown email — avoids leaking which emails have accounts. Returns null only when there's genuinely no email to send to. */
export async function createPasswordResetToken(env: Env, email: string): Promise<string | null> {
  const user = await getUser(env, email);
  if (!user) return null;
  const token = crypto.randomUUID();
  const record: PasswordResetToken = { userId: user.id, expiresAt: Date.now() + RESET_TOKEN_TTL_SECONDS * 1000 };
  await env.STATE_KV.put(`reset:${token}`, JSON.stringify(record), { expirationTtl: RESET_TOKEN_TTL_SECONDS });
  return token;
}

export async function consumePasswordResetToken(env: Env, token: string): Promise<string | null> {
  const record = await env.STATE_KV.get<PasswordResetToken>(`reset:${token}`, "json");
  if (!record || record.expiresAt < Date.now()) return null;
  await env.STATE_KV.delete(`reset:${token}`);
  return record.userId;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const record: SessionRecord = { userId };
  await env.STATE_KV.put(`session:${token}`, JSON.stringify(record));
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.STATE_KV.delete(`session:${token}`);
}

/** Minted once for the native Android wrapper, alongside its FCM token registration — no expiry, since
 * a background notification-action tap has no cookie jar to renew a session from. */
export async function createDeviceToken(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const record: DeviceTokenRecord = { userId };
  await env.STATE_KV.put(`devicetoken:${token}`, JSON.stringify(record));
  return token;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

// SameSite=None because the static frontend (GitHub Pages) and this Worker
// are different origins; CORS in index.ts restricts which origins can use it.
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

export async function requireAuth(request: Request, env: Env): Promise<string | null> {
  // The native Android wrapper's background notification-action handler has no cookie jar to send —
  // it authenticates with its own long-lived device token instead, checked first.
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const deviceToken = await env.STATE_KV.get<DeviceTokenRecord>(`devicetoken:${authHeader.slice(7)}`, "json");
    if (deviceToken) return deviceToken.userId;
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await env.STATE_KV.get<SessionRecord>(`session:${token}`, "json");
  if (!session) return null;
  return session.userId;
}

export function getSessionToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return cookies[SESSION_COOKIE] ?? null;
}

export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const user = await getUser(env, userId);
  return user?.isAdmin === true;
}
