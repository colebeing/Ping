import { api, LIVE_BLOCKS, type Answer, type BlockId, type Cadence, type Category, type FollowupPrompt, type LiveBlockId } from "../api";
import { mountBlockCard, button, CATEGORY_LABEL } from "../blockCard";

const DAYS_SHOWN = 14;
const TWICE_BLOCKS: BlockId[] = ["1", "2"];

export function localDateStr(timezone: string, at: Date): string {
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
 * Past days' mode is decided by whatever data they actually have, not by the
 * account's current setting — that's what lets some days in History be
 * Twice Daily and others Once Daily as the setting changes over time. Only
 * a fully blank past day falls back to the current setting, since there's
 * nothing else to go on for it.
 */
async function renderDay(container: HTMLElement, date: string, cadence: Cadence): Promise<void> {
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

  const quadAnswers = await Promise.all(LIVE_BLOCKS.map((block) => api.getQuestion(block, date)));
  const answeredQuad = LIVE_BLOCKS.filter((_, i) => quadAnswers[i].existingAnswer);
  if (answeredQuad.length > 0) {
    // Show every block that was actually answered this day, plus any block still live on the
    // current cadence — a block permanently skipped since then, and never answered on this
    // specific day, shouldn't sit here forever as an open, unanswered prompt.
    const stillLive = LIVE_BLOCKS.filter((b) => !cadence.skippedBlocks.includes(b));
    const toShow = LIVE_BLOCKS.filter((b) => answeredQuad.includes(b) || stillLive.includes(b));
    renderBlocks(container, toShow, date);
    return;
  }

  // Fully blank past day — nothing to preserve, so use whichever blocks are live now.
  const liveNow: LiveBlockId[] = LIVE_BLOCKS.filter((b) => !cadence.skippedBlocks.includes(b));
  if (liveNow.length === 1) void mountBlockCard(container, liveNow[0], date);
  else void renderCollapsedDay(container, date, liveNow);
}

/**
 * Renders the last DAYS_SHOWN-1 days *before* today, one per calendar day — today itself is
 * Home's job (the live, actionable day gets its own hero treatment there), this is purely the
 * backward-looking list Home reveals under its "Show history" toggle.
 */
export function renderHistoryList(root: HTMLElement, cadence: Cadence, today: string): void {
  root.innerHTML = "";
  const [, yesterday] = recentDates(today, 2);

  for (const date of recentDates(today, DAYS_SHOWN).slice(1)) {
    const dayHeading = document.createElement("p");
    dayHeading.className = "muted";
    dayHeading.style.margin = "18px 0 4px";
    dayHeading.textContent = dayLabel(date, today, yesterday);
    root.appendChild(dayHeading);

    const dayContainer = document.createElement("div");
    root.appendChild(dayContainer);
    void renderDay(dayContainer, date, cadence);
  }
}
