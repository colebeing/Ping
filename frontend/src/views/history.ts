import { api } from "../api";
import { mountBlockCard, BLOCK_LABEL } from "../blockCard";

const DAYS_SHOWN = 14;

function localDateStr(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function recentDates(today: string, count: number): string[] {
  const base = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10));
}

function dayLabel(date: string, today: string, yesterday: string): string {
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function renderLocked(container: HTMLElement): void {
  container.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card";
  const label = document.createElement("span");
  label.className = "pill";
  label.textContent = BLOCK_LABEL["2"];
  card.appendChild(label);
  const p = document.createElement("p");
  p.className = "muted";
  p.style.marginTop = "8px";
  p.textContent = "Answer Morning first";
  card.appendChild(p);
  container.appendChild(card);
}

export async function renderHistory(root: HTMLElement): Promise<void> {
  root.innerHTML = `<h2>History</h2><div class="card">Loading…</div>`;
  try {
    const me = await api.me();
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "History";
    root.appendChild(heading);

    const today = localDateStr(me.cadence.timezone, new Date());
    const [, yesterday] = recentDates(today, 2);

    for (const date of recentDates(today, DAYS_SHOWN)) {
      const dayHeading = document.createElement("p");
      dayHeading.className = "muted";
      dayHeading.style.margin = "18px 0 4px";
      dayHeading.textContent = dayLabel(date, today, yesterday);
      root.appendChild(dayHeading);

      const morningContainer = document.createElement("div");
      root.appendChild(morningContainer);
      const eveningContainer = document.createElement("div");
      root.appendChild(eveningContainer);

      // Evening starts locked; Morning's onDone (fires immediately if
      // already complete, or live once the user finishes it) reveals it.
      renderLocked(eveningContainer);
      void mountBlockCard(morningContainer, "1", date, () => {
        void mountBlockCard(eveningContainer, "2", date);
      });
    }
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load history.</div>`;
    console.error(err);
  }
}
