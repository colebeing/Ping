import { api, type Answer, type Category, type FollowupPrompt, type Frequency } from "../api";
import { mountBlockCard, button, CATEGORY_LABEL } from "../blockCard";

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

/** Morning + Evening, as two independently fillable blocks — either can be answered first. */
function renderTwoBlocks(container: HTMLElement, date: string): void {
  container.innerHTML = "";
  const morningContainer = document.createElement("div");
  container.appendChild(morningContainer);
  const eveningContainer = document.createElement("div");
  container.appendChild(eveningContainer);

  void mountBlockCard(morningContainer, "1", date);
  void mountBlockCard(eveningContainer, "2", date);
}

/**
 * For a past day with nothing recorded on either block: one question instead
 * of two. Answering it records the same answer + category on both blocks
 * under the hood, so once done it reads identically to a normally-answered day.
 */
async function renderCollapsedDay(container: HTMLElement, date: string): Promise<void> {
  container.innerHTML = `<div class="card">Loading…</div>`;
  try {
    let step: { kind: "question" } | { kind: "followup"; answer: Answer; prompt: FollowupPrompt } = {
      kind: "question",
    };
    let pendingAnswer: Answer = "yes";

    const paint = () => {
      const card = document.createElement("div");
      card.className = "card";

      const question = document.createElement("h3");
      question.textContent = "Did the day go how you wanted?";
      card.appendChild(question);

      if (step.kind === "question") {
        const row = document.createElement("div");
        row.className = "btn-row";
        row.append(button("Yes", "btn btn-primary", () => submitAnswer("yes")), button("No", "btn", () => submitAnswer("no")));
        card.appendChild(row);
      } else {
        const p = document.createElement("p");
        p.textContent = step.prompt.prompt;
        card.appendChild(p);
        const grid = document.createElement("div");
        grid.className = "option-grid";
        for (const cat of Object.keys(CATEGORY_LABEL) as Category[]) {
          grid.appendChild(button(step.prompt.options[cat], "btn", () => submitFollowup(cat)));
        }
        card.appendChild(grid);
      }

      container.innerHTML = "";
      container.appendChild(card);
    };

    const submitAnswer = async (answer: Answer) => {
      pendingAnswer = answer;
      const res = await api.answer("1", answer, date);
      step = { kind: "followup", answer, prompt: res.followup };
      paint();
    };

    const submitFollowup = async (category: Category) => {
      await api.followup("1", category, date);
      await api.answer("2", pendingAnswer, date);
      await api.followup("2", category, date);
      renderTwoBlocks(container, date);
    };

    paint();
  } catch (err) {
    container.innerHTML = `<div class="card error">Couldn't load this day.</div>`;
    console.error(err);
  }
}

/**
 * Each day's mode is decided by whatever data it actually has, not by the
 * account's current setting — that's what lets some days in History be
 * Twice Daily and others Once Daily as the setting changes over time. Only
 * a fully blank day falls back to the current setting, since there's
 * nothing else to go on for it.
 */
async function renderDay(container: HTMLElement, date: string, isToday: boolean, currentFrequency: Frequency): Promise<void> {
  container.innerHTML = `<div class="card">Loading…</div>`;

  const combined = await api.getQuestion("combined", date);
  if (combined.existingAnswer) {
    void mountBlockCard(container, "combined", date);
    return;
  }

  const [morning, evening] = await Promise.all([api.getQuestion("1", date), api.getQuestion("2", date)]);
  if (morning.existingAnswer || evening.existingAnswer) {
    renderTwoBlocks(container, date);
    return;
  }

  // Fully blank — nothing to preserve, so use whichever mode is active now.
  if (currentFrequency === "once") {
    void mountBlockCard(container, "combined", date);
  } else if (isToday) {
    renderTwoBlocks(container, date);
  } else {
    void renderCollapsedDay(container, date);
  }
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

      const dayContainer = document.createElement("div");
      root.appendChild(dayContainer);
      void renderDay(dayContainer, date, date === today, me.cadence.frequency);
    }
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load history.</div>`;
    console.error(err);
  }
}
