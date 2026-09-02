import type { Env } from "./types";

const STATE_TTL_SECONDS = 10 * 60; // 10 minutes — plenty for the redirect round-trip

interface OAuthState {
  expiresAt: number;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function callbackUrl(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/auth/google/callback`;
}

/** The nonce itself is the CSRF protection for the OAuth redirect round-trip — no invite gating anymore, so there's nothing else to carry through it. */
export async function createOAuthState(env: Env): Promise<string> {
  const nonce = crypto.randomUUID();
  const record: OAuthState = { expiresAt: Date.now() + STATE_TTL_SECONDS * 1000 };
  await env.STATE_KV.put(`oauth-state:${nonce}`, JSON.stringify(record), { expirationTtl: STATE_TTL_SECONDS });
  return nonce;
}

export async function consumeOAuthState(env: Env, nonce: string): Promise<OAuthState | null> {
  const record = await env.STATE_KV.get<OAuthState>(`oauth-state:${nonce}`, "json");
  if (!record || record.expiresAt < Date.now()) return null;
  await env.STATE_KV.delete(`oauth-state:${nonce}`);
  return record;
}

export function buildGoogleAuthUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
}

export async function exchangeCodeForToken(env: Env, code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

interface GoogleUserInfo {
  email: string;
  email_verified: boolean;
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status} ${await res.text()}`);
  return res.json();
}
