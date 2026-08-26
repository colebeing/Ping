import { api, type BlockId, type HistoryAnswer } from "../api";
import { mountBlockCard, BLOCK_LABEL, CATEGORY_LABEL } from "../blockCard";

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
    const [me, { answers }] = await Promise.all([api.me(), api.getHistory()]);
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "History";
    root.appendChild(heading);

    const today = localDateStr(me.cadence.timezone, new Date());
    const [, yesterday] = recentDates(today, 2);
    const byKey = new Map<string, HistoryAnswer>(answers.map((a) => [`${a.date}:${a.block}`, a]));

    for (const date of recentDates(today, DAYS_SHOWN)) {
      const dayHeading = document.createElement("p");
      dayHeading.className = "muted";
      dayHeading.style.margin = "18px 0 4px";
      dayHeading.textContent = dayLabel(date, today, yesterday);
      root.appendChild(dayHeading);

      for (const block of ["1", "2"] as BlockId[]) {
        if (date === today) {
          const container = document.createElement("div");
          root.appendChild(container);
          void mountBlockCard(container, block);
        } else {
          root.appendChild(renderStaticEntry(block, byKey.get(`${date}:${block}`)));
        }
      }
    }
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load history.</div>`;
    console.error(err);
  }
}

function renderStaticEntry(block: BlockId, entry: HistoryAnswer | undefined): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const label = document.createElement("span");
  label.className = "pill";
  label.textContent = BLOCK_LABEL[block];
  card.appendChild(label);

  if (entry) {
    const answerPill = document.createElement("span");
    answerPill.className = `pill answered-${entry.answer}`;
    answerPill.style.marginLeft = "8px";
    answerPill.textContent = entry.answer === "yes" ? "Yes" : "No";
    card.appendChild(answerPill);

    if (entry.category) {
      const cat = document.createElement("p");
      cat.className = "muted";
      cat.style.marginTop = "8px";
      cat.textContent = CATEGORY_LABEL[entry.category];
      card.appendChild(cat);
    }
  } else {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.marginTop = "8px";
    p.textContent = "Not answered";
    card.appendChild(p);
  }

  return card;
}
