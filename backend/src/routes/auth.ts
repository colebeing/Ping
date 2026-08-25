import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { createSession, createUser, destroySession, getSessionToken, getUser, sessionCookieHeader, clearSessionCookieHeader, verifyPassword } from "../auth";

interface Credentials {
  email: string;
  password: string;
}

export async function handleSignup(request: Request, env: Env): Promise<Response> {
  const { email, password } = await readJson<Credentials>(request);
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

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = await readJson<Credentials>(request);
  const user = await getUser(env, email ?? "");
  if (!user || !(await verifyPassword(password ?? "", user.salt, user.passwordHash))) {
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
