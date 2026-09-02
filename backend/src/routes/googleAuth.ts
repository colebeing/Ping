import type { Env } from "../types";
import { errorResponse } from "../http";
import { getUser, createUserFromGoogle, createSession, sessionCookieHeader } from "../auth";
import {
  googleConfigured,
  callbackUrl,
  createOAuthState,
  consumeOAuthState,
  buildGoogleAuthUrl,
  exchangeCodeForToken,
  getGoogleUserInfo,
} from "../google-auth";

function frontendUrl(env: Env): string {
  return (env.FRONTEND_URL ?? "").replace(/\/$/, "") || "/";
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

    let user = await getUser(env, info.email);
    if (!user) user = await createUserFromGoogle(env, info.email);

    const sessionToken = await createSession(env, user.id);
    return new Response(null, {
      status: 302,
      headers: { Location: `${front}/`, "Set-Cookie": sessionCookieHeader(sessionToken) },
    });
  } catch (err) {
    console.error("Google auth callback failed", err);
    return Response.redirect(`${front}/?error=google-auth-failed`, 302);
  }
}
