import type { Env } from "./types";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/** The one service account this backend has — shared across every Google API that needs
 * server-to-server auth (FCM today, Sheets now) rather than minting a separate one per integration. */
export function parseServiceAccount(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    return JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  } catch {
    return null;
  }
}

function base64url(bytes: ArrayBuffer | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let binary = "";
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Google hands out service account private keys as PEM-wrapped PKCS8 — strip the wrapper, decode the base64 body. */
function pkcs8FromPem(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Cached per Worker isolate, keyed by scope — a token is valid for an hour and each scope (FCM sends,
// Sheets pushes/pulls) is used at most a few times a day, so this avoids minting a fresh one on every
// call without needing any persistent storage. Keyed by scope, not just "the" token, since FCM and
// Sheets need tokens for different scopes off the same service account.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Mints (or reuses a cached) OAuth2 access token for this service account, scoped to `scope` — the
 * standard JWT-bearer flow for server-to-server Google API auth, no user consent involved. */
export async function getGoogleAccessToken(account: ServiceAccount, scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data: { access_token: string; expires_in: number } = await res.json();
  tokenCache.set(scope, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
