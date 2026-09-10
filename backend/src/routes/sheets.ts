import type { Env } from "../types";
import { errorResponse, json } from "../http";
import { getQuestionRoot } from "../config";
import { pushTreeToSheet, pullTreeFromSheet } from "../sheets";

export async function handlePushToSheet(_request: Request, env: Env): Promise<Response> {
  const root = await getQuestionRoot(env);
  const result = await pushTreeToSheet(env, root);
  if (!result.ok) return errorResponse(result.error, 502);
  return json({ ok: true });
}

/** Never writes to KV — hands back the reconstructed tree (or specific validation errors) for the
 * admin to review; applying it still goes through the existing PUT /api/admin/config save path. */
export async function handlePullFromSheet(_request: Request, env: Env): Promise<Response> {
  const result = await pullTreeFromSheet(env);
  if (!result.ok) return json({ errors: result.errors }, 422);
  return json({ root: result.root });
}
