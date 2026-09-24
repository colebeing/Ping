import "./style.css";
import { api, ApiError, isBlockId, type BlockId } from "./api";
import { renderAuth } from "./views/auth";
import { renderHome } from "./views/home";
import { renderSettings } from "./views/settings";
import { renderAdmin } from "./views/admin";
import { renderAnalytics } from "./views/analytics";

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
  await redeemGoogleHandoff();
  try {
    const me = await api.me();
    showApp(me.isAdmin);
  } catch (err) {
    // Only a genuine "no session" (401) should mint a fresh anonymous account — a transient
    // network/5xx failure must never trigger that side effect for someone who actually already
    // has a valid session, so it falls back to the login screen instead.
    if (err instanceof ApiError && err.status === 401) {
      try {
        await api.startAnonymous();
        const me = await api.me();
        showApp(me.isAdmin);
      } catch {
        showAuth();
      }
    } else {
      showAuth();
    }
  }
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

  const renderActive = () => {
    // Admin's question map/tree can run wide with real content — widen the shared #app container for
    // it specifically (gated by a min-width media query, so phone widths are untouched) rather than
    // loosening the mobile-first layout everywhere.
    document.body.classList.toggle("admin-view", active === "admin");
    if (active === "home") void renderHome(content, goSettings);
    else if (active === "admin") void renderAdmin(content);
    else if (active === "analytics") void renderAnalytics(content);
    else
      void renderSettings(content, goHome, () => {
        tabs?.remove();
        document.body.classList.remove("no-tabs");
        showAuth();
      });
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
