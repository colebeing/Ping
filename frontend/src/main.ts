import "./style.css";
import { api, ApiError, isBlockId, type BlockId } from "./api";
import { renderAuth } from "./views/auth";
import { renderHome } from "./views/home";
import { renderSettings } from "./views/settings";
import { renderAdmin } from "./views/admin";
import { renderAnalytics } from "./views/analytics";
import { captureReferral, takePendingReferral } from "./invite";
import { describeError } from "./errorDetail";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.error("SW registration failed", err));
  });
  // Fired when a notification (its Yes/No action, or just tapping it) was
  // handled in the background and the app was already open — jump to Home,
  // which always shows every one of today's blocks that's actually started
  // (the tapped one included), instead of leaving a stale "Yes/No" card
  // showing wherever the user happened to be.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ping:go-to-block" && isBlockId(event.data.block)) void goToBlock?.(event.data.block);
  });
}

let goToBlock: ((block: BlockId) => void) | null = null;

type Tab = "home" | "settings" | "admin" | "analytics";

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app root element");

/** The web Google redirect lands back with a one-time code in the fragment (see the backend's
 * handleGoogleCallback) — trade it for the session token before anything reads the session. On
 * failure, leave the auth screen's existing ?error= message for whenever it's shown. */
async function redeemGoogleHandoff(): Promise<void> {
  const match = location.hash.match(/^#google-handoff=([\w-]+)$/);
  if (!match) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    await api.redeemGoogleHandoff(match[1]);
  } catch (err) {
    console.error("[ping] google handoff failed", err);
    history.replaceState(null, "", `${location.pathname}?error=google-auth-expired`);
  }
}

async function boot(): Promise<void> {
  captureReferral();
  await redeemGoogleHandoff();
  // A password-reset email link's form lives on the auth screen — and since every visitor has at
  // least an anonymous session, boot would otherwise always skip straight past it into the app.
  if (new URLSearchParams(location.search).has("reset")) {
    showAuth();
    return;
  }
  try {
    const me = await withRetry(() => api.me());
    showApp(me.isAdmin);
  } catch (err) {
    // Only a genuine "no session" (401) should mint a fresh anonymous account — a network/5xx failure
    // must never trigger that side effect for someone who may already have a valid session, so after
    // its retries it offers to try again instead.
    if (err instanceof ApiError && err.status === 401) await startFresh();
    else showConnectError(err);
  }
}

// A cold start (e.g. the Android app's first launch right after clearing its data) can hit a network
// that isn't quite up yet — worth a couple of quiet retries before saying anything at all.
const RETRY_DELAYS_MS = [1000, 3000];

/** Retries only what could plausibly succeed a moment later: a request that never got a response,
 * a server error, or rate limiting. A real answer like 401 comes straight back. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
      if (!transient || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/** A brand-new anonymous account — the first-visit experience, and also where logging out lands,
 * so logging out never leaves you at a sign-in wall you didn't ask for. Signing into an existing
 * account is its own explicit choice (Settings' "Already have an account? Sign in"). */
async function startFresh(): Promise<void> {
  const ref = takePendingReferral();
  try {
    // Retried as two separate steps, never as one: if the account was created but loading it failed,
    // retrying the whole thing would mint a second account and orphan the first.
    await withRetry(() => api.startAnonymous(ref));
    const me = await withRetry(() => api.me());
    showApp(me.isAdmin);
  } catch (err) {
    showConnectError(err);
  }
}

/** Where a failed start lands instead of the sign-in screen, which nobody asked for — showing what
 * actually went wrong, so a report from a phone says more than "it showed the login page". "Try again"
 * re-runs boot from the top: if the anonymous account did get created, its saved session picks up
 * from there rather than creating another. */
function showConnectError(err: unknown): void {
  console.error("[ping] couldn't start", err);
  goToBlock = null;
  app!.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card";
  const heading = document.createElement("h3");
  heading.textContent = "Couldn't connect to Ping";
  const detail = document.createElement("p");
  detail.className = "muted";
  detail.textContent = describeError(err) ?? "Check your connection and try again.";
  const retry = document.createElement("button");
  retry.className = "btn btn-primary";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    retry.setAttribute("disabled", "true");
    retry.textContent = "Connecting…";
    void boot();
  });
  card.append(heading, detail, retry);
  app!.appendChild(card);
}

function showAuth(): void {
  goToBlock = null;
  app!.innerHTML = "";
  renderAuth(app!, () => {
    void api.me().then((me) => showApp(me.isAdmin));
  });
}

function showApp(isAdmin: boolean): void {
  app!.innerHTML = "";
  const content = document.createElement("div");
  app!.appendChild(content);

  // Settings isn't worth a permanent footer tab for the average user — it's reached via the gear
  // icon on Home instead. Admins still get a footer, but it's just their own Home/Analytics/Admin
  // switcher; they reach Settings the same gear-icon way as everyone else.
  let tabs: HTMLElement | null = null;
  if (isAdmin) {
    tabs = document.createElement("nav");
    tabs.className = "tabs";
    document.body.appendChild(tabs);
  } else {
    document.body.classList.add("no-tabs");
  }

  const tabDefs: { id: Tab; label: string }[] = isAdmin
    ? [
        { id: "home", label: "Home" },
        { id: "analytics", label: "Analytics" },
        { id: "admin", label: "Admin" },
      ]
    : [];
  const validTabs: Tab[] = ["home", "settings", ...tabDefs.filter((d) => d.id !== "home").map((d) => d.id)];

  // Stay on the tab across a refresh by round-tripping it through the URL hash. Admin extends its own
  // hash with a "/"-separated question path (see admin.ts's encodeHashForPath/decodePathFromHash) —
  // only the segment before the first "/" is the tab name, so that extra addressing doesn't register
  // as an unrecognized tab and fall back to Home.
  const tabFromHash = (): Tab => {
    const h = location.hash.slice(1).split("/")[0];
    return (validTabs as string[]).includes(h) ? (h as Tab) : "home";
  };

  let active: Tab = tabFromHash();
  // The Admin tab button below can't just always jump to the bare "#admin" root — that's exactly what
  // threw away the question you were looking at on every trip through Home/Analytics. This remembers
  // the fullest admin address seen so far (including its own question sub-path) so clicking back into
  // Admin restores it, without admin.ts needing any cross-view API to report its own state up to here.
  let lastAdminHash = location.hash.slice(1).split("/")[0] === "admin" ? location.hash.slice(1) : "admin";

  const goHome = () => {
    active = "home";
    location.hash = "home";
    renderActive();
  };
  const goSettings = () => {
    active = "settings";
    location.hash = "settings";
    renderActive();
  };

  // Home always shows every one of today's blocks that's actually started,
  // the tapped one included, so there's nowhere else a notification could
  // need to route to.
  goToBlock = (_block) => goHome();

  const teardown = () => {
    tabs?.remove();
    document.body.classList.remove("no-tabs");
    // replaceState, not location.hash — that would fire this instance's own hashchange listener.
    history.replaceState(null, "", location.pathname + location.search);
  };

  const renderActive = () => {
    // Admin's question map/tree can run wide with real content — widen the shared #app container for
    // it specifically (gated by a min-width media query, so phone widths are untouched) rather than
    // loosening the mobile-first layout everywhere.
    document.body.classList.toggle("admin-view", active === "admin");
    if (active === "home") void renderHome(content, goSettings);
    else if (active === "admin") void renderAdmin(content);
    else if (active === "analytics") void renderAnalytics(content);
    else
      void renderSettings(
        content,
        goHome,
        () => {
          teardown();
          void startFresh();
        },
        () => {
          teardown();
          showAuth();
        },
      );
    if (tabs) {
      for (const btn of Array.from(tabs.children) as HTMLButtonElement[]) {
        btn.classList.toggle("active", btn.dataset.tab === active);
      }
    }
  };

  window.addEventListener("hashchange", () => {
    const raw = location.hash.slice(1);
    if (raw.split("/")[0] === "admin") lastAdminHash = raw;
    const next = tabFromHash();
    if (next !== active) {
      active = next;
      renderActive();
    }
  });

  // Refresh on refocus, not just when a notification message arrives — a tab
  // brought to the foreground (e.g. by tapping a notification) can otherwise
  // sit for a moment showing whatever stale card it had before backgrounding,
  // Yes/No buttons included, which a reflexive tap could use to overwrite an
  // answer the notification itself just recorded. Re-rendering immediately
  // swaps that stale card for a loading state before it's clickable again.
  // Scoped to Home only — that's the sole view with this stale-action-button
  // race. Admin's tree editor keeps real in-progress state across refocus
  // instead (which path is open, the map's expanded/collapsed state, any
  // pending Sheet-sync preview) that a blanket refresh on every view would
  // otherwise wipe out on every alt-tab back into the app.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && active === "home") renderActive();
  });

  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.dataset.tab = def.id;
    btn.textContent = def.label;
    btn.addEventListener("click", () => {
      active = def.id;
      location.hash = def.id === "admin" ? lastAdminHash : def.id;
      renderActive();
    });
    tabs!.appendChild(btn);
  }

  renderActive();
}

void boot();
