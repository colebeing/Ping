import type { Env } from "./types";

export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — email not sent:", subject, "->", to);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "Ping <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) console.error("email send failed", res.status, await res.text());
  return res.ok;
}

function frontendUrl(env: Env): string {
  return (env.FRONTEND_URL ?? "").replace(/\/$/, "");
}

export async function sendPasswordResetEmail(env: Env, to: string, token: string): Promise<boolean> {
  const link = `${frontendUrl(env)}/?reset=${encodeURIComponent(token)}`;
  return sendEmail(
    env,
    to,
    "Reset your Ping password",
    `<p>Someone (hopefully you) asked to reset the password on your Ping account.</p>
     <p><a href="${link}">Set a new password</a></p>
     <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
  );
}

export async function sendInviteEmail(env: Env, to: string, invitedBy: string, token: string): Promise<boolean> {
  const link = `${frontendUrl(env)}/?invite=${encodeURIComponent(token)}`;
  return sendEmail(
    env,
    to,
    `${invitedBy} invited you to Ping`,
    `<p>${invitedBy} invited you to Ping — a quick twice-daily check-in on whether your day is going how you wanted.</p>
     <p><a href="${link}">Accept the invite</a></p>
     <p>This link expires in 7 days.</p>`,
  );
}
