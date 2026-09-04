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

interface SignupBody {
  email: string;
  password: string;
}

export async function handleSignup(request: Request, env: Env): Promise<Response> {
  const { email, password } = await readJson<SignupBody>(request);
  if (!email || !password || password.length < 8) {
    return errorResponse("Email and a password of at least 8 characters are required", 400);
  }

  try {
    const user = await createUser(env, email, password);
    const token = await createSession(env, user.id);
    return json({ email: user.email }, 201, { "Set-Cookie": sessionCookieHeader(token) });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Signup failed", 409);
  }
}

interface Credentials {
  email: string;
  password: string;
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await readJson<Credentials>(request);
  const user = await getUser(env, email ?? "");
  if (!user?.passwordHash || !user.salt || !(await verifyPassword(password ?? "", user.salt, user.passwordHash))) {
    return errorResponse("Invalid email or password", 401);
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
