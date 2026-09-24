import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import {
  getUser,
  createUserFromGoogle,
  createSession,
  sessionCookieHeader,
  createGoogleHandoffCode,
  consumeGoogleHandoffCode,
} from "../auth";
import { claimOrLoginWithGoogleEmail } from "./account";
import {
  googleConfigured,
  callbackUrl,
  createOAuthState,
  consumeOAuthState,
  buildGoogleAuthUrl,
  exchangeCodeForToken,
  getGoogleUserInfo,
  verifyGoogleIdToken,
} from "../google-auth";

function frontendUrl(env: Env): string {
  return (env.FRONTEND_URL ?? "").replace(/\/$/, "") || "/";
}

/** Shared by both the redirect flow below and the native token flow: given a verified Google email, get or create the account and start a session. */
async function loginOrSignUpWithGoogleEmail(env: Env, email: string): Promise<string> {
  let user = await getUser(env, email);
  if (!user) user = await createUserFromGoogle(env, email);
  return createSession(env, user.id);
}

export async function handleGoogleStart(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) return errorResponse("Google sign-in isn't configured on the server", 501);
  const state = await createOAuthState(env);
  const redirectUri = callbackUrl(request.url);
  return Response.redirect(buildGoogleAuthUrl(env, redirectUri, state), 302);
}

export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const front = frontendUrl(env);
  if (!googleConfigured(env)) return errorResponse("Google sign-in isn't configured on the server", 501);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  // Consumed before anything else can fail, so a failed claim attempt (including cancelling on
  // Google's own screen, which still returns the state) lands back on Settings where it started —
  // not the sign-in screen, which an anonymous user already in the app would never see.
  const state = stateParam ? await consumeOAuthState(env, stateParam) : null;
  const fail = (kind: string) =>
    Response.redirect(state?.claim ? `${front}/?claim-error=${kind}#settings` : `${front}/?error=${kind}`, 302);
  if (!code || !stateParam) return fail("google-auth-failed");
  if (!state) return fail("google-auth-expired");

  try {
    const redirectUri = callbackUrl(request.url);
    const tokens = await exchangeCodeForToken(env, code, redirectUri);
    const info = await getGoogleUserInfo(tokens.access_token);
    if (!info.email_verified) return fail("google-email-unverified");

    let sessionToken: string;
    if (state.claim) {
      try {
        sessionToken = await claimOrLoginWithGoogleEmail(env, state.claim.fromUserId, state.claim.fromSessionToken, info.email);
      } catch (err) {
        console.error("Google claim failed", err);
        return fail("google-claim-failed");
      }
    } else {
      sessionToken = await loginOrSignUpWithGoogleEmail(env, info.email);
    }
    // The cookie alone isn't enough — browsers blocking third-party cookies won't send it from the
    // frontend's origin — so also hand back a one-time code (in the fragment, never sent to any
    // server) that the frontend trades for the token via handleGoogleHandoff below.
    const handoffCode = await createGoogleHandoffCode(env, sessionToken);
    return new Response(null, {
      status: 302,
      headers: { Location: `${front}/#google-handoff=${handoffCode}`, "Set-Cookie": sessionCookieHeader(sessionToken) },
    });
  } catch (err) {
    console.error("Google auth callback failed", err);
    return fail("google-auth-failed");
  }
}

interface GoogleTokenBody {
  idToken: string;
}

/**
 * Native Google Sign-In (Android's Credential Manager account picker, no browser hop) hands the app
 * an ID token directly instead of doing the redirect dance handleGoogleCallback above does — this is
 * that path's counterpart, landing in the exact same account + session logic.
 */
export async function handleGoogleTokenSignIn(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) return errorResponse("Google sign-in isn't configured on the server", 501);

  const { idToken } = await readJson<GoogleTokenBody>(request);
  if (!idToken) return errorResponse("idToken is required", 400);

  const info = await verifyGoogleIdToken(env, idToken);
  if (!info) return errorResponse("That Google sign-in couldn't be verified", 401);
  if (!info.email_verified) return errorResponse("That Google account's email isn't verified", 401);

  const sessionToken = await loginOrSignUpWithGoogleEmail(env, info.email);
  return json({ email: info.email, sessionToken }, 200, { "Set-Cookie": sessionCookieHeader(sessionToken) });
}

/** Trades the one-time code from handleGoogleCallback's redirect for the session token itself. */
export async function handleGoogleHandoff(request: Request, env: Env): Promise<Response> {
  const { code } = await readJson<{ code: string }>(request);
  if (!code) return errorResponse("code is required", 400);
  const sessionToken = await consumeGoogleHandoffCode(env, code);
  if (!sessionToken) return errorResponse("That sign-in attempt expired. Try again.", 401);
  return json({ sessionToken });
}
