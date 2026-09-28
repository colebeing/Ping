import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { api } from "./api";

const REF_PARAM = "ref";
// Kept in memory, not storage: it's only ever meant to ride along with the one anonymous account
// this page load is about to create (see main.ts's startFresh), never a later one after a logout.
let pendingRef: string | null = null;

/** Called once at boot, before anything can strip the query string — lifts ?ref= off the URL so
 * a reload or a copied address bar doesn't keep re-carrying someone else's code. */
export function captureReferral(): void {
  const params = new URLSearchParams(location.search);
  const ref = params.get(REF_PARAM);
  if (ref === null) return;
  pendingRef = ref;
  params.delete(REF_PARAM);
  const query = params.toString();
  history.replaceState(null, "", location.pathname + (query ? `?${query}` : "") + location.hash);
}

/** One-shot: the code goes to the backend with the first account this page creates, then is gone. */
export function takePendingReferral(): string | undefined {
  const ref = pendingRef ?? undefined;
  pendingRef = null;
  return ref;
}

/** Where an invite link points. A native build's own origin (capacitor://localhost) is no use to a
 * friend, so there it must be set explicitly; on the web the current origin is the app itself. */
function shareBase(): string | null {
  const configured = import.meta.env.VITE_SHARE_URL as string | undefined;
  if (configured) return configured;
  return Capacitor.isNativePlatform() ? null : location.origin + location.pathname;
}

export function inviteAvailable(): boolean {
  return shareBase() !== null;
}

export type InviteResult = "shared" | "copied" | "cancelled";

/** Opens the native share sheet (or the browser's, or falls back to copying the link) — the sender
 * picks the friend and the app in the OS's own UI, so Ping never sees or types an address. */
export async function inviteFriend(): Promise<InviteResult> {
  const base = shareBase();
  if (!base) throw new Error("Invites aren't set up for this build");
  const { code } = await api.getReferralCode();
  const url = `${base}${base.includes("?") ? "&" : "?"}${REF_PARAM}=${encodeURIComponent(code)}`;
  const text = "Lightweight coaching that adapts to you. No login or setup necessary:";

  if (Capacitor.isNativePlatform() || (await Share.canShare()).value) {
    try {
      await Share.share({ title: "Ping", text, url, dialogTitle: "Invite a friend" });
      return "shared";
    } catch (err) {
      // Dismissing the sheet rejects with a "cancel" message on every platform this plugin covers.
      if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return "cancelled";
      throw err;
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`);
  return "copied";
}
