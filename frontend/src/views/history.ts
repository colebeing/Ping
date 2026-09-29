import { api, LIVE_BLOCKS, type Answer, type BlockId, type Cadence, type Category, type FollowupPrompt, type LiveBlockId } from "../api";
import { mountBlockCard, button, CATEGORY_LABEL } from "../blockCard";

/** History loads this many days at a time; "Show older days" appends the next page. */
const PAGE_DAYS = 14;
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
function renderBlocks(container: HTMLElement, blocks: BlockId[], date: string, onQuestionChanged: () => void): void {
  container.innerHTML = "";
  for (const block of blocks) {
    const blockContainer = document.createElement("div");
    container.appendChild(blockContainer);
    void mountBlockCard(blockContainer, block, date, undefined, onQuestionChanged);
  }
}

/**
 * For a past day with nothing recorded on any of `blocks`: one question
 * instead of several. Answering it records the same answer + category on
 * every block under the hood, so once done it reads identically to a
 * normally-answered day.
 */
async function renderCollapsedDay(container: HTMLElement, date: string, blocks: BlockId[], onQuestionChanged: () => void): Promise<void> {
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
      renderBlocks(container, blocks, date, onQuestionChanged);
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
async function renderDay(container: HTMLElement, date: string, cadence: Cadence, onQuestionChanged: () => void): Promise<void> {
  container.innerHTML = `<div class="card">Loading…</div>`;

  const combined = await api.getQuestion("combined", date);
  if (combined.existingAnswer) {
    void mountBlockCard(container, "combined", date, undefined, onQuestionChanged);
    return;
  }

  const [morning, evening] = await Promise.all([api.getQuestion("1", date), api.getQuestion("2", date)]);
  if (morning.existingAnswer || evening.existingAnswer) {
    renderBlocks(container, TWICE_BLOCKS, date, onQuestionChanged);
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
    renderBlocks(container, toShow, date, onQuestionChanged);
    return;
  }

  // Fully blank past day — nothing to preserve, so use whichever blocks are live now.
  const liveNow: LiveBlockId[] = LIVE_BLOCKS.filter((b) => !cadence.skippedBlocks.includes(b));
  if (liveNow.length === 1) void mountBlockCard(container, liveNow[0], date, undefined, onQuestionChanged);
  else void renderCollapsedDay(container, date, liveNow, onQuestionChanged);
}

/** How many days back (including yesterday) History currently shows. Module-level so a full Home
 * re-render (e.g. after returning to an earlier question) doesn't drop the user back to page one. */
let daysLoaded = PAGE_DAYS;

/**
 * Renders the days *before* today, newest first, one per calendar day, PAGE_DAYS at a time — today
 * itself is Home's job (the live, actionable day gets its own hero treatment there), this is purely
 * the backward-looking list Home reveals under its "Show history" toggle. Pages stop at `earliest`
 * (the account's first day of any kind), so the whole history is reachable and nothing before it
 * renders as endless blank days. `onQuestionChanged` fires when a card changes the account's question
 * (e.g. "Go back to this question"), since that changes what every other day's card should offer.
 */
export function renderHistoryList(root: HTMLElement, cadence: Cadence, today: string, earliest: string, onQuestionChanged: () => void): void {
  root.innerHTML = "";
  const [, yesterday] = recentDates(today, 2);
  // Every day from yesterday back to the account's first day; only a page's worth is rendered at a time.
  const span = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86400000);
  const dates = recentDates(today, Math.max(span, 0) + 1).slice(1);

  let rendered = 0;
  const more = document.createElement("button");
  more.className = "history-toggle";
  more.innerHTML = `<span>Show older days</span><span class="chev">▾</span>`;
  more.addEventListener("click", () => {
    daysLoaded += PAGE_DAYS;
    renderNext();
  });

  const renderNext = () => {
    more.remove();
    for (const date of dates.slice(rendered, daysLoaded)) {
      const dayHeading = document.createElement("p");
      dayHeading.className = "muted";
      dayHeading.style.margin = "18px 0 4px";
      dayHeading.textContent = dayLabel(date, today, yesterday);
      root.appendChild(dayHeading);

      const dayContainer = document.createElement("div");
      root.appendChild(dayContainer);
      void renderDay(dayContainer, date, cadence, onQuestionChanged);
      rendered++;
    }
    if (rendered < dates.length) root.appendChild(more);
  };
  renderNext();
}
