import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import {
  claimAccount,
  createAnonymousUser,
  createSession,
  destroySession,
  getSessionToken,
  hashPassword,
  sessionCookieHeader,
} from "../auth";
import { googleConfigured, verifyGoogleIdToken } from "../google-auth";

/** The zero-friction entry point — mints an anonymous account and session with no credentials at
 * all, so "grant notifications" can be the only thing standing between opening Ping and using it. */
export async function handleStartAnonymous(_request: Request, env: Env): Promise<Response> {
  const user = await createAnonymousUser(env);
  const token = await createSession(env, user.id);
  return json({ email: null }, 201, { "Set-Cookie": sessionCookieHeader(token) });
}

interface ClaimPasswordBody {
  email: string;
  password: string;
}

/** Attaches a real email+password to the current (anonymous) session's account, in place — see
 * claimAccount's doc comment for how the migration itself works. */
export async function handleClaimWithPassword(request: Request, env: Env, userId: string): Promise<Response> {
  const { email, password } = await readJson<ClaimPasswordBody>(request);
  if (!email || !password || password.length < 8) {
    return errorResponse("Email and a password of at least 8 characters are required", 400);
  }

  try {
    const { hash, salt } = await hashPassword(password);
    const user = await claimAccount(env, userId, email, { passwordHash: hash, salt });
    const oldToken = getSessionToken(request);
    if (oldToken) await destroySession(env, oldToken);
    const token = await createSession(env, user.id);
    return json({ email: user.email }, 200, { "Set-Cookie": sessionCookieHeader(token) });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Couldn't save your account", 409);
  }
}

interface ClaimGoogleBody {
  idToken: string;
}

/**
 * Native-only for now — the web Google flow is a full-page redirect that never hands the frontend
 * an ID token to POST here, unlike the native picker's signInWithGoogle(). Web users can still claim
 * with email+password, which works everywhere.
 */
export async function handleClaimWithGoogle(request: Request, env: Env, userId: string): Promise<Response> {
  if (!googleConfigured(env)) return errorResponse("Google sign-in isn't configured on the server", 501);

  const { idToken } = await readJson<ClaimGoogleBody>(request);
  if (!idToken) return errorResponse("idToken is required", 400);

  const info = await verifyGoogleIdToken(env, idToken);
  if (!info) return errorResponse("That Google sign-in couldn't be verified", 401);
  if (!info.email_verified) return errorResponse("That Google account's email isn't verified", 401);

  try {
    const user = await claimAccount(env, userId, info.email, null);
    const oldToken = getSessionToken(request);
    if (oldToken) await destroySession(env, oldToken);
    const token = await createSession(env, user.id);
    return json({ email: user.email }, 200, { "Set-Cookie": sessionCookieHeader(token) });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Couldn't save your account", 409);
  }
}
