import type { Env, UserRecord } from "../types";
import { errorResponse, json, readJson } from "../http";
import {
  claimAccount,
  createAnonymousUser,
  createSession,
  destroySession,
  getSessionToken,
  getUser,
  hashPassword,
  normalizeEmail,
  sessionCookieHeader,
} from "../auth";
import { buildGoogleAuthUrl, callbackUrl, createOAuthState, googleConfigured, verifyGoogleIdToken } from "../google-auth";

/** The zero-friction entry point — mints an anonymous account and session with no credentials at
 * all, so "grant notifications" can be the only thing standing between opening Ping and using it. */
export async function handleStartAnonymous(_request: Request, env: Env): Promise<Response> {
  const user = await createAnonymousUser(env);
  const token = await createSession(env, user.id);
  return json({ email: null, sessionToken: token }, 201, { "Set-Cookie": sessionCookieHeader(token) });
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
    return json({ email: user.email, sessionToken: token }, 200, { "Set-Cookie": sessionCookieHeader(token) });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Couldn't save your account", 409);
  }
}

interface ClaimGoogleBody {
  idToken: string;
}

/**
 * Native's path — the native picker's signInWithGoogle() hands over an ID token directly. Web's
 * redirect flow never does, so it claims via handleStartGoogleClaim below instead.
 *
 * Unlike password-claim below, a taken email here isn't a conflict to reject: verifyGoogleIdToken
 * already cryptographically proves the user owns this email (a freely-typed password proves nothing
 * of the kind), so if an account already exists under it — e.g. they signed in with this same Google
 * account from another device before — this is just a login, exactly like the plain sign-in screen's
 * own get-or-create. Only actually claim (migrate this anonymous session onto the email) when no
 * account exists yet.
 */
export async function handleClaimWithGoogle(request: Request, env: Env, userId: string): Promise<Response> {
  if (!googleConfigured(env)) return errorResponse("Google sign-in isn't configured on the server", 501);

  const { idToken } = await readJson<ClaimGoogleBody>(request);
  if (!idToken) return errorResponse("idToken is required", 400);

  const info = await verifyGoogleIdToken(env, idToken);
  if (!info) return errorResponse("That Google sign-in couldn't be verified", 401);
  if (!info.email_verified) return errorResponse("That Google account's email isn't verified", 401);

  try {
    const token = await claimOrLoginWithGoogleEmail(env, userId, getSessionToken(request), info.email);
    return json({ email: normalizeEmail(info.email), sessionToken: token }, 200, { "Set-Cookie": sessionCookieHeader(token) });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Couldn't save your account", 409);
  }
}

/**
 * The claim decision above, shared with the web redirect flow (googleAuth.ts's callback): attach a
 * verified Google email to the anonymous account, or just log into it if it already has an account.
 * Replaces the anonymous session with a fresh one under the resulting account; returns its token.
 */
export async function claimOrLoginWithGoogleEmail(
  env: Env,
  fromUserId: string,
  fromSessionToken: string | null,
  email: string,
): Promise<string> {
  const existing = await getUser(env, email);
  const user: UserRecord = existing ?? (await claimAccount(env, fromUserId, email, null));
  if (fromSessionToken) await destroySession(env, fromSessionToken);
  return createSession(env, user.id);
}

/**
 * Web's counterpart to handleClaimWithGoogle: the web Google flow is a full-page redirect that never
 * hands the frontend an ID token, so instead this records which anonymous account to claim in the
 * OAuth state and returns the Google URL for the frontend to navigate to. The callback finishes it.
 */
export async function handleStartGoogleClaim(request: Request, env: Env, userId: string): Promise<Response> {
  if (!googleConfigured(env)) return errorResponse("Google sign-in isn't configured on the server", 501);
  const user = await getUser(env, userId);
  if (user?.email) return errorResponse("This account already has an email saved", 409);
  const state = await createOAuthState(env, { fromUserId: userId, fromSessionToken: getSessionToken(request) });
  return json({ url: buildGoogleAuthUrl(env, callbackUrl(request.url), state) });
}
