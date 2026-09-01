import { api, type Answer, type BlockId, type Category, type FollowupPrompt, type Frequency } from "../api";
import { mountBlockCard, button, CATEGORY_LABEL } from "../blockCard";

const DAYS_SHOWN = 14;
const TWICE_BLOCKS: BlockId[] = ["1", "2"];
const FOUR_BLOCKS: BlockId[] = ["q1", "q2", "q3", "q4"];

function localDateStr(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function recentDates(today: string, count: number): string[] {
  const base = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10));
}

function weekdayShort(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function dayLabel(date: string, today: string, yesterday: string): string {
  if (date === today) return `Today · ${weekdayShort(date)}`;
  if (date === yesterday) return `Yesterday · ${weekdayShort(date)}`;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Each of `blocks` as an independently fillable block — any can be answered first. */
function renderBlocks(container: HTMLElement, blocks: BlockId[], date: string): void {
  container.innerHTML = "";
  for (const block of blocks) {
    const blockContainer = document.createElement("div");
    container.appendChild(blockContainer);
    void mountBlockCard(blockContainer, block, date);
  }
}

/**
 * For a past day with nothing recorded on any of `blocks`: one question
 * instead of several. Answering it records the same answer + category on
 * every block under the hood, so once done it reads identically to a
 * normally-answered day.
 */
async function renderCollapsedDay(container: HTMLElement, date: string, blocks: BlockId[]): Promise<void> {
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
      const res = await api.answer(blocks[0], answer, date);
      step = { kind: "followup", answer, prompt: res.followup };
      paint();
    };

    const submitFollowup = async (category: Category) => {
      await api.followup(blocks[0], category, date);
      for (const block of blocks.slice(1)) {
        await api.answer(block, pendingAnswer, date);
        await api.followup(block, category, date);
      }
      renderBlocks(container, blocks, date);
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
    renderBlocks(container, TWICE_BLOCKS, date);
    return;
  }

  const quadAnswers = await Promise.all(FOUR_BLOCKS.map((block) => api.getQuestion(block, date)));
  if (quadAnswers.some((q) => q.existingAnswer)) {
    renderBlocks(container, FOUR_BLOCKS, date);
    return;
  }

  // Fully blank — nothing to preserve, so use whichever mode is active now.
  if (currentFrequency === "once") {
    void mountBlockCard(container, "combined", date);
  } else if (currentFrequency === "four") {
    if (isToday) renderBlocks(container, FOUR_BLOCKS, date);
    else void renderCollapsedDay(container, date, FOUR_BLOCKS);
  } else if (isToday) {
    renderBlocks(container, TWICE_BLOCKS, date);
  } else {
    void renderCollapsedDay(container, date, TWICE_BLOCKS);
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
