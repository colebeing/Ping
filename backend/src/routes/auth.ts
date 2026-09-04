import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import {
  createSession,
  createUser,
  destroySession,
  getSessionToken,
  getUser,
  sessionCookieHeader,
  clearSessionCookieHeader,
  verifyPassword,
  createPasswordResetToken,
  consumePasswordResetToken,
  setPassword,
} from "../auth";
import { sendPasswordResetEmail } from "../email";

interface Credentials {
  email: string;
  password: string;
}

/**
 * Signing in and signing up are the same action now — deliberately: a new email creates the
 * account on the spot rather than bouncing to a separate signup form, since the two flows felt
 * identical anyway. An email that already has a password gets verified as a real login; an email
 * with no password on file (e.g. a Google-only account) falls through to the same "invalid" error
 * as a wrong password — same generic message either way, so this can't be used to enumerate which
 * emails have accounts.
 */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await readJson<Credentials>(request);
  if (!email || !password || password.length < 8) {
    return errorResponse("Email and a password of at least 8 characters are required", 400);
  }

  let user = await getUser(env, email);
  if (user) {
    if (!user.passwordHash || !user.salt || !(await verifyPassword(password, user.salt, user.passwordHash))) {
      return errorResponse("Invalid email or password", 401);
    }
  } else {
    user = await createUser(env, email, password);
  }

  const token = await createSession(env, user.id);
  return json({ email: user.email }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getSessionToken(request);
  if (token) await destroySession(env, token);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
}

export async function handleRequestPasswordReset(request: Request, env: Env): Promise<Response> {
  const { email } = await readJson<{ email: string }>(request);
  if (email) {
    const token = await createPasswordResetToken(env, email);
    if (token) await sendPasswordResetEmail(env, email, token);
  }
  // Always the same response, whether or not the email has an account.
  return json({ ok: true });
}

export async function handleConfirmPasswordReset(request: Request, env: Env): Promise<Response> {
  const { token, newPassword } = await readJson<{ token: string; newPassword: string }>(request);
  if (!newPassword || newPassword.length < 8) {
    return errorResponse("Password must be at least 8 characters", 400);
  }
  const userId = await consumePasswordResetToken(env, token);
  if (!userId) return errorResponse("This reset link is invalid or has expired", 400);
  await setPassword(env, userId, newPassword);
  return json({ ok: true });
}
