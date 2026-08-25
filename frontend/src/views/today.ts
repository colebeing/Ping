import { api, type Answer, type BlockId, type Cadence, type Category, type FollowupPrompt, type FollowupVariant, type Recommendation } from "../api";

const BLOCK_LABEL: Record<BlockId, string> = { "1": "Morning", "2": "Evening" };
const OTHER_BLOCK: Record<BlockId, BlockId> = { "1": "2", "2": "1" };
const CATEGORY_LABEL: Record<Category, string> = { friends: "Friends", work: "Work", home: "Home", capacity: "Capacity" };

type Step =
  | { kind: "question" }
  | { kind: "followup"; answer: Answer; variant: FollowupVariant; prompt: FollowupPrompt }
  | { kind: "done"; answer: Answer };

/** Whichever block's check-in time most recently passed is "current" — handles wraparound past midnight. */
function currentBlock(cadence: Cadence): BlockId {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return ((h % 24) * 60 + (m || 0) + 1440) % 1440;
  };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cadence.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const now = hh * 60 + mm;

  const since = (target: number) => (now - target + 1440) % 1440;
  return since(toMinutes(cadence.block1)) <= since(toMinutes(cadence.block2)) ? "1" : "2";
}

export async function renderToday(root: HTMLElement, onRecommendations: (recs: Recommendation[]) => void): Promise<void> {
  root.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Today";
  root.appendChild(heading);

  const primary = document.createElement("div");
  root.appendChild(primary);

  let block: BlockId = "1";
  try {
    const me = await api.me();
    block = currentBlock(me.cadence);
  } catch {
    // fall through with block "1" — mountBlock's own error handling covers a real auth failure
  }

  void mountBlock(primary, block, onRecommendations);

  const otherToggle = document.createElement("button");
  otherToggle.className = "btn";
  otherToggle.style.marginTop = "4px";
  otherToggle.textContent = `Missed ${BLOCK_LABEL[OTHER_BLOCK[block]]}? Answer it too`;
  const otherContainer = document.createElement("div");
  otherToggle.addEventListener("click", () => {
    otherToggle.remove();
    root.appendChild(otherContainer);
    void mountBlock(otherContainer, OTHER_BLOCK[block], onRecommendations);
  });
  root.appendChild(otherToggle);
}

async function mountBlock(container: HTMLElement, block: BlockId, onRecommendations: (recs: Recommendation[]) => void): Promise<void> {
  container.innerHTML = `<div class="card">Loading…</div>`;
  try {
    const q = await api.getQuestion(block);
    let step: Step;

    if (!q.existingAnswer) {
      step = { kind: "question" };
    } else if (!q.existingAnswer.category) {
      // Answered yes/no already (e.g. from a notification action) but the
      // follow-up category wasn't picked yet — resume where it left off
      // instead of showing "done". Re-posting the same answer is a safe
      // no-op server-side and hands back the follow-up content we need.
      const res = await api.answer(block, q.existingAnswer.answer);
      step = { kind: "followup", answer: q.existingAnswer.answer, variant: res.followup.variant, prompt: res.followup };
    } else {
      step = { kind: "done", answer: q.existingAnswer.answer };
    }

    const paint = () => {
      const card = document.createElement("div");
      card.className = "card";

      const label = document.createElement("span");
      label.className = "pill";
      label.textContent = BLOCK_LABEL[block];
      card.appendChild(label);

      const question = document.createElement("h3");
      question.style.marginTop = "10px";
      question.textContent = q.text;
      card.appendChild(question);

      if (step.kind === "question") {
        const row = document.createElement("div");
        row.className = "btn-row";
        const yes = button("Yes", "btn btn-primary", () => submitAnswer("yes"));
        const no = button("No", "btn", () => submitAnswer("no"));
        row.append(yes, no);
        card.appendChild(row);
      } else if (step.kind === "followup") {
        const p = document.createElement("p");
        p.textContent = step.prompt.prompt;
        card.appendChild(p);
        const grid = document.createElement("div");
        grid.className = "option-grid";
        for (const cat of Object.keys(CATEGORY_LABEL) as Category[]) {
          grid.appendChild(button(step.prompt.options[cat], "btn", () => submitFollowup(step as Extract<Step, { kind: "followup" }>, cat)));
        }
        card.appendChild(grid);
      } else {
        const pill = document.createElement("span");
        pill.className = `pill answered-${step.answer}`;
        pill.textContent = step.answer === "yes" ? "Answered: yes" : "Answered: no";
        card.appendChild(pill);
        const edit = button("Edit", "btn", () => {
          step = { kind: "question" };
          paint();
        });
        edit.style.marginLeft = "8px";
        card.appendChild(edit);
      }

      container.innerHTML = "";
      container.appendChild(card);
    };

    const submitAnswer = async (answer: Answer) => {
      const res = await api.answer(block, answer);
      step = { kind: "followup", answer, variant: res.followup.variant, prompt: res.followup };
      paint();
    };

    const submitFollowup = async (current: Extract<Step, { kind: "followup" }>, category: Category) => {
      const res = await api.followup(block, category);
      if (res.pendingRecommendations?.length) onRecommendations(res.pendingRecommendations);
      step = { kind: "done", answer: current.answer };
      paint();
    };

    paint();
  } catch (err) {
    container.innerHTML = `<div class="card error">Couldn't load this block.</div>`;
    console.error(err);
  }
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}
