import "./style.css";
import { api } from "./api";
import { renderAuth } from "./views/auth";
import { renderToday } from "./views/today";
import { renderHistory } from "./views/history";
import { renderSettings } from "./views/settings";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.error("SW registration failed", err));
  });
  // Fired when a notification's Yes/No action already answered a block in
  // the background and the app was already open — jump to Today and
  // re-render so it reflects that instead of showing stale yes/no buttons.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ping:go-to-today") goToToday?.();
  });
}

let goToToday: (() => void) | null = null;

type Tab = "today" | "history" | "settings";

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app root element");

async function boot(): Promise<void> {
  try {
    await api.me();
    showApp();
  } catch {
    showAuth();
  }
}

function showAuth(): void {
  goToToday = null;
  app!.innerHTML = "";
  renderAuth(app!, showApp);
}

function showApp(): void {
  app!.innerHTML = "";
  const content = document.createElement("div");
  app!.appendChild(content);

  const tabs = document.createElement("nav");
  tabs.className = "tabs";
  document.body.appendChild(tabs);

  let active: Tab = "today";

  goToToday = () => {
    active = "today";
    renderActive();
  };

  const renderActive = () => {
    if (active === "today") void renderToday(content);
    else if (active === "history") void renderHistory(content);
    else void renderSettings(content, () => {
      tabs.remove();
      showAuth();
    });
    for (const btn of Array.from(tabs.children) as HTMLButtonElement[]) {
      btn.classList.toggle("active", btn.dataset.tab === active);
    }
  };

  const tabDefs: { id: Tab; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "history", label: "History" },
    { id: "settings", label: "Settings" },
  ];
  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.dataset.tab = def.id;
    btn.textContent = def.label;
    btn.addEventListener("click", () => {
      active = def.id;
      renderActive();
    });
    tabs.appendChild(btn);
  }

  renderActive();
}

void boot();
