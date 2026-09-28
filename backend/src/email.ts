import { CATEGORY_LABEL, type Env, type GapWarning } from "./types";

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

// "general" stands in for a null category — mirrors frontend/src/views/admin.ts's own
// GENERAL_CATEGORY_TOKEN/encodeHashForPath so a link built here lands on the exact same Admin row.
const GENERAL_CATEGORY_TOKEN = "general";

function encodeGapWarningHash(path: GapWarning["path"]): string {
  if (path.length === 0) return "admin";
  return "admin/" + path.map((step) => `${step.valence}.${step.category ?? GENERAL_CATEGORY_TOKEN}`).join("/");
}

/** Fired once per gap, right when it opens (see recommendations.ts's checkGapWarning and its
 * state.notifiedGaps dedup) — a heads-up that someone is one response away from completing a streak
 * whose destination slot in the question tree isn't authored yet, so it can be filled in before that
 * next matching answer arrives. Best-effort: env.ADMIN_EMAIL being unset just skips this channel — the
 * Admin UI's gap map flags the same gap regardless (see routes/admin.ts, getGapWarnings). */
export async function sendGapWarningEmail(env: Env, warning: GapWarning): Promise<boolean> {
  if (!env.ADMIN_EMAIL) return false;
  const who = warning.email ?? `an anonymous user (${warning.userId})`;
  const what = warning.category
    ? `a ${warning.valence === "yes" ? "yes" : "no"} streak in ${CATEGORY_LABEL[warning.category]}`
    : `a mixed-category ${warning.valence === "yes" ? "yes" : "no"} streak`;
  const link = `${frontendUrl(env)}/#${encodeGapWarningHash(warning.path)}`;
  return sendEmail(
    env,
    env.ADMIN_EMAIL,
    "Ping admin: a swap question needs authoring",
    `<p>${who} is one response away (${warning.count}/${warning.threshold}) from ${what} — but there's no swap question ready for it yet.</p>
     <p><a href="${link}">Add one in Admin →</a></p>`,
  );
}
