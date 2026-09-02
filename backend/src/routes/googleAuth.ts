import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getUser, createUserFromGoogle, createSession, sessionCookieHeader } from "../auth";
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
  if (!code || !stateParam) return Response.redirect(`${front}/?error=google-auth-failed`, 302);

  const state = await consumeOAuthState(env, stateParam);
  if (!state) return Response.redirect(`${front}/?error=google-auth-expired`, 302);

  try {
    const redirectUri = callbackUrl(request.url);
    const tokens = await exchangeCodeForToken(env, code, redirectUri);
    const info = await getGoogleUserInfo(tokens.access_token);
    if (!info.email_verified) return Response.redirect(`${front}/?error=google-email-unverified`, 302);

    const sessionToken = await loginOrSignUpWithGoogleEmail(env, info.email);
    return new Response(null, {
      status: 302,
      headers: { Location: `${front}/`, "Set-Cookie": sessionCookieHeader(sessionToken) },
    });
  } catch (err) {
    console.error("Google auth callback failed", err);
    return Response.redirect(`${front}/?error=google-auth-failed`, 302);
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
  return json({ email: info.email }, 200, { "Set-Cookie": sessionCookieHeader(sessionToken) });
}
