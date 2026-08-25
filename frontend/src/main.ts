import "./style.css";
import { api } from "./api";
import { renderAuth } from "./views/auth";
import { renderToday } from "./views/today";
import { renderRecommendations } from "./views/recommendations";
import { renderSettings } from "./views/settings";
import type { Recommendation } from "./api";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.error("SW registration failed", err));
  });
}

type Tab = "today" | "recommendations" | "settings";

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
  app!.innerHTML = "";
  renderAuth(app!, showApp);
}

function showApp(): void {
  app!.innerHTML = "";

  const banner = document.createElement("div");
  const content = document.createElement("div");
  app!.append(banner, content);

  const tabs = document.createElement("nav");
  tabs.className = "tabs";
  document.body.appendChild(tabs);

  let active: Tab = "today";

  const renderActive = () => {
    if (active === "today") renderToday(content, handleRecommendations);
    else if (active === "recommendations") void renderRecommendations(content);
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
    { id: "recommendations", label: "Suggestions" },
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

  function handleRecommendations(recs: Recommendation[]): void {
    if (recs.length === 0) return;
    banner.innerHTML = "";
    const el = document.createElement("div");
    el.className = "banner";
    el.innerHTML = `<strong>New suggestion available</strong><p class="muted">Check the Suggestions tab.</p>`;
    banner.appendChild(el);
  }

  renderActive();
}

void boot();
