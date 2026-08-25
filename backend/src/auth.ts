import type { Env, PasswordResetToken, SessionRecord, UserRecord } from "./types";

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
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

export async function createUser(env: Env, email: string, password: string): Promise<UserRecord> {
  const id = normalizeEmail(email);
  const existing = await env.STATE_KV.get(`user:${id}`);
  if (existing) throw new Error("An account with that email already exists");
  const { hash, salt } = await hashPassword(password);
  const user: UserRecord = { id, email: id, passwordHash: hash, salt, createdAt: new Date().toISOString() };
  await env.STATE_KV.put(`user:${id}`, JSON.stringify(user));
  return user;
}

export async function getUser(env: Env, email: string): Promise<UserRecord | null> {
  return env.STATE_KV.get<UserRecord>(`user:${normalizeEmail(email)}`, "json");
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
  const record: SessionRecord = { userId, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
  await env.STATE_KV.put(`session:${token}`, JSON.stringify(record), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.STATE_KV.delete(`session:${token}`);
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
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

export async function requireAuth(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await env.STATE_KV.get<SessionRecord>(`session:${token}`, "json");
  if (!session || session.expiresAt < Date.now()) return null;
  return session.userId;
}

export function getSessionToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return cookies[SESSION_COOKIE] ?? null;
}
