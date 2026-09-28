import { describe, expect, it } from "vitest";
import { claimAccount, getUser, isValidReferralCode } from "../auth";
import { FakeKV } from "../test/helpers";
import type { Env, UserRecord } from "../types";
import { handleGetReferralCode, handleStartAnonymous } from "./account";

function buildEnv(): Env {
  return { CONFIG_KV: new FakeKV(), STATE_KV: new FakeKV() } as unknown as Env;
}

function startRequest(body?: unknown): Request {
  return new Request("https://x/api/account/start", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

async function startAndGetUser(env: Env, body?: unknown): Promise<UserRecord> {
  const res = await handleStartAnonymous(startRequest(body), env);
  expect(res.status).toBe(201);
  const token = ((await res.json()) as { sessionToken: string }).sessionToken;
  const session = await env.STATE_KV.get<{ userId: string }>(`session:${token}`, "json");
  return (await getUser(env, session!.userId))!;
}

describe("referral codes", () => {
  it("mints a stable, valid code lazily and reuses it", async () => {
    const env = buildEnv();
    const user = await startAndGetUser(env);
    expect(user.referralCode).toBeUndefined();

    const first = ((await (await handleGetReferralCode(new Request("https://x"), env, user.id)).json()) as { code: string }).code;
    const second = ((await (await handleGetReferralCode(new Request("https://x"), env, user.id)).json()) as { code: string }).code;
    expect(isValidReferralCode(first)).toBe(true);
    expect(second).toBe(first);
  });

  it("records a valid ref on a new anonymous account", async () => {
    const env = buildEnv();
    const user = await startAndGetUser(env, { ref: "abcd2345" });
    expect(user.referredBy).toBe("abcd2345");
  });

  it("ignores a malformed ref and a missing body without blocking signup", async () => {
    const env = buildEnv();
    expect((await startAndGetUser(env, { ref: "<script>" })).referredBy).toBeUndefined();
    expect((await startAndGetUser(env)).referredBy).toBeUndefined();
  });

  it("keeps the code and attribution when the anonymous account is claimed", async () => {
    const env = buildEnv();
    const user = await startAndGetUser(env, { ref: "abcd2345" });
    const res = await handleGetReferralCode(new Request("https://x"), env, user.id);
    const { code } = (await res.json()) as { code: string };
    const claimed = await claimAccount(env, user.id, "Friend@Example.com", null);
    expect(claimed.referralCode).toBe(code);
    expect(claimed.referredBy).toBe("abcd2345");
  });
});
