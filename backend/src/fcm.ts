import type { Env } from "./types";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function parseServiceAccount(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    return JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  } catch {
    return null;
  }
}

export function fcmConfigured(env: Env): boolean {
  return parseServiceAccount(env) !== null;
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

// Cached per Worker isolate — an access token is valid for an hour and pushes
// happen at most a couple of times a day per user, so this avoids minting a
// fresh one on every send without needing any persistent storage.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
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
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  const data: { access_token: string; expires_in: number } = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/**
 * Sends a data-only FCM message (no `notification` payload) so the app's own
 * FirebaseMessagingService fully controls how it's displayed — needed for
 * the multi-action, swap-in-place notification the native wrapper builds.
 */
export async function sendFcmPush(env: Env, token: string, data: Record<string, string>): Promise<boolean> {
  const account = parseServiceAccount(env);
  if (!account) return false;
  try {
    const accessToken = await getAccessToken(account);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data, android: { priority: "high" } } }),
    });
    if (!res.ok) console.error("FCM send failed", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("FCM send failed", err);
    return false;
  }
}
