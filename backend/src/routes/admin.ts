import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getFullAdminConfig, saveFullAdminConfig, type FullAdminConfig } from "../config";

export async function handleGetAdminConfig(_request: Request, env: Env): Promise<Response> {
  return json(await getFullAdminConfig(env));
}

export async function handleSaveAdminConfig(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Partial<FullAdminConfig>>(request);
  if (!body.blocks || !body.triggers || !body.recommendationCopy) {
    return errorResponse("Request must include blocks, triggers, and recommendationCopy", 400);
  }
  await saveFullAdminConfig(env, body as FullAdminConfig);
  return json({ ok: true });
}
