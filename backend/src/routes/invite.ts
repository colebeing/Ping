import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { createInvite } from "../invites";
import { sendInviteEmail } from "../email";
import { getUser } from "../auth";

export async function handleCreateInvite(request: Request, env: Env, userId: string): Promise<Response> {
  const { email } = await readJson<{ email: string }>(request);
  if (!email) return errorResponse("Email is required", 400);

  const existing = await getUser(env, email);
  if (existing) return errorResponse("That email already has an account", 409);

  const token = await createInvite(env, email, userId);
  const sent = await sendInviteEmail(env, email, userId, token);
  if (!sent) return errorResponse("Invite created but the email failed to send — check RESEND_API_KEY is set", 502);

  return json({ ok: true });
}
