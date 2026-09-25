import { describe, expect, it } from "vitest";
import { resolveDate, todayLocal } from "./state";

describe("todayLocal", () => {
  it("formats as YYYY-MM-DD in the given IANA timezone", () => {
    // 2024-03-01T23:30:00Z is already 2024-03-02 in UTC+2 (e.g. Europe/Athens).
    const at = new Date("2024-03-01T23:30:00.000Z");
    expect(todayLocal("UTC", at)).toBe("2024-03-01");
    expect(todayLocal("Europe/Athens", at)).toBe("2024-03-02");
  });
});

describe("resolveDate", () => {
  const timezone = "UTC";

  it("defaults to today when nothing is requested", () => {
    expect(resolveDate(timezone, undefined)).toBe(todayLocal(timezone));
    expect(resolveDate(timezone, null)).toBe(todayLocal(timezone));
  });

  it("defaults to today for a string that doesn't match YYYY-MM-DD", () => {
    expect(resolveDate(timezone, "not-a-date")).toBe(todayLocal(timezone));
    expect(resolveDate(timezone, "2024/01/01")).toBe(todayLocal(timezone));
  });

  it("passes through a valid past date unchanged", () => {
    expect(resolveDate(timezone, "2020-01-01")).toBe("2020-01-01");
  });

  it("never allows answering ahead of today — caps a future date to today", () => {
    const farFuture = "2999-01-01";
    expect(resolveDate(timezone, farFuture)).toBe(todayLocal(timezone));
  });
});
