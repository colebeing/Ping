import { ApiError } from "./api";

/**
 * Best-effort human-readable detail for any thrown value, not just real `Error` instances — a Capacitor
 * plugin rejection often comes through as a plain `{code, message}`-shaped object that isn't
 * `instanceof Error` at all, which a check that only handles `ApiError`/`Error` silently swallows into
 * nothing (exactly what happened here: the generic fallback showed with no detail, meaning the actual
 * thrown value matched none of those checks). Falls all the way to a raw stringification rather than
 * ever going quietly generic, since a wrong-shaped error is much easier to fix once actually visible.
 */
export function describeError(err: unknown): string | null {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) {
      return typeof obj.code === "string" && obj.code ? `${obj.message} (${obj.code})` : obj.message;
    }
    if (typeof obj.code === "string" && obj.code) return obj.code;
    try {
      const json = JSON.stringify(obj);
      if (json && json !== "{}") return json;
    } catch {
      // Circular or otherwise unserializable — fall through to the generic String() below.
    }
  }
  if (typeof err === "string" && err) return err;
  return err === undefined || err === null ? null : String(err);
}
