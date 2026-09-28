import type { Env } from "../types";
import { errorResponse, json, readJson } from "../http";
import { getFullAdminConfig, saveFullAdminConfig, getConfigAuditLog, getGapWarnings, type FullAdminConfig } from "../config";

export async function handleGetAdminConfig(_request: Request, env: Env): Promise<Response> {
  const sheetUrl = env.SHEETS_SPREADSHEET_ID ? `https://docs.google.com/spreadsheets/d/${env.SHEETS_SPREADSHEET_ID}/edit` : undefined;
  const [config, gapWarnings] = await Promise.all([getFullAdminConfig(env), getGapWarnings(env)]);
  return json({ ...config, sheetUrl, gapWarnings });
}

export async function handleSaveAdminConfig(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<Partial<FullAdminConfig>>(request);
  if (!body.blocks || !body.triggers || !body.questionRoot) {
    return errorResponse("Request must include blocks, triggers, and questionRoot", 400);
  }
  await saveFullAdminConfig(env, body as FullAdminConfig, userId);
  return json({ ok: true });
}

export async function handleGetConfigAuditLog(_request: Request, env: Env): Promise<Response> {
  return json(await getConfigAuditLog(env));
}
