import { api, type BlockId } from "../api";
import { mountBlockCard } from "../blockCard";

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

      for (const block of ["1", "2"] as BlockId[]) {
        const container = document.createElement("div");
        root.appendChild(container);
        void mountBlockCard(container, block, date);
      }
    }
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load history.</div>`;
    console.error(err);
  }
}
