import "./style.css";
import { api, isBlockId, type BlockId } from "./api";
import { renderAuth } from "./views/auth";
import { renderToday, currentBlockForCadence } from "./views/today";
import { renderHistory } from "./views/history";
import { renderSettings } from "./views/settings";
import { renderAdmin } from "./views/admin";
import { renderAnalytics } from "./views/analytics";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.error("SW registration failed", err));
  });
  // Fired when a notification (its Yes/No action, or just tapping it) was
  // handled in the background and the app was already open — jump to
  // whichever tab actually reflects that block right now instead of leaving
  // a stale "Yes/No" card showing, or landing on the wrong block's card.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ping:go-to-block" && isBlockId(event.data.block)) void goToBlock?.(event.data.block);
  });
}

let goToBlock: ((block: BlockId) => Promise<void>) | null = null;

type Tab = "today" | "history" | "settings" | "admin" | "analytics";

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app root element");

async function boot(): Promise<void> {
  try {
    const me = await api.me();
    showApp(me.isAdmin);
  } catch {
    showAuth();
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

  const tabs = document.createElement("nav");
  tabs.className = "tabs";
  document.body.appendChild(tabs);

  const tabDefs: { id: Tab; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "history", label: "History" },
    { id: "settings", label: "Settings" },
  ];
  if (isAdmin) tabDefs.push({ id: "analytics", label: "Analytics" }, { id: "admin", label: "Admin" });
  const validTabs = tabDefs.map((d) => d.id);

  // Stay on the tab across a refresh by round-tripping it through the URL hash.
  const tabFromHash = (): Tab => {
    const h = location.hash.slice(1);
    return (validTabs as string[]).includes(h) ? (h as Tab) : "today";
  };

  let active: Tab = tabFromHash();

  // A notification is only for "Today" while it's still the block Today
  // would show anyway — once the view has moved on to the other block (or
  // rolled to a new day), sending the user to Today would show the wrong
  // block, so land on History instead where that day's own card is correct.
  goToBlock = async (block) => {
    let target: Tab = "today";
    try {
      const me = await api.me();
      if (currentBlockForCadence(me.cadence) !== block) target = "history";
    } catch {
      // fall through to Today — mountBlockCard's own error handling covers a real auth failure
    }
    active = target;
    location.hash = target;
    renderActive();
  };

  const renderActive = () => {
    if (active === "today") void renderToday(content);
    else if (active === "history") void renderHistory(content);
    else if (active === "admin") void renderAdmin(content);
    else if (active === "analytics") void renderAnalytics(content);
    else void renderSettings(content, () => {
      tabs.remove();
      showAuth();
    });
    for (const btn of Array.from(tabs.children) as HTMLButtonElement[]) {
      btn.classList.toggle("active", btn.dataset.tab === active);
    }
  };

  window.addEventListener("hashchange", () => {
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderActive();
  });

  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.dataset.tab = def.id;
    btn.textContent = def.label;
    btn.addEventListener("click", () => {
      active = def.id;
      location.hash = def.id;
      renderActive();
    });
    tabs.appendChild(btn);
  }

  renderActive();
}

void boot();
