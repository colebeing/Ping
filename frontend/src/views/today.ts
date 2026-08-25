import { api, type Answer, type BlockId, type Category, type FollowupPrompt, type FollowupVariant, type Recommendation } from "../api";

const BLOCK_LABEL: Record<BlockId, string> = { "1": "Morning", "2": "Evening" };
const CATEGORY_LABEL: Record<Category, string> = { friends: "Friends", work: "Work", home: "Home", capacity: "Capacity" };

type Step =
  | { kind: "question" }
  | { kind: "followup"; answer: Answer; variant: FollowupVariant; prompt: FollowupPrompt }
  | { kind: "done"; answer: Answer };

export function renderToday(root: HTMLElement, onRecommendations: (recs: Recommendation[]) => void): void {
  root.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Today";
  root.appendChild(heading);

  const block1 = document.createElement("div");
  const block2 = document.createElement("div");
  root.appendChild(block1);
  root.appendChild(block2);

  void mountBlock(block1, "1", onRecommendations);
  void mountBlock(block2, "2", onRecommendations);
}

async function mountBlock(container: HTMLElement, block: BlockId, onRecommendations: (recs: Recommendation[]) => void): Promise<void> {
  container.innerHTML = `<div class="card">Loading…</div>`;
  try {
    const q = await api.getQuestion(block);
    let step: Step = q.existingAnswer
      ? { kind: "done", answer: q.existingAnswer.answer }
      : { kind: "question" };

    let pendingFollowups: { what: FollowupPrompt; why: FollowupPrompt } | null = null;

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
      pendingFollowups = res.followups;
      step = { kind: "followup", answer, variant: "what", prompt: res.followups.what };
      paint();
    };

    const submitFollowup = async (current: Extract<Step, { kind: "followup" }>, category: Category) => {
      const res = await api.followup(block, current.variant, category);
      if (res.pendingRecommendations?.length) onRecommendations(res.pendingRecommendations);

      if (current.variant === "what" && pendingFollowups) {
        step = { kind: "followup", answer: current.answer, variant: "why", prompt: pendingFollowups.why };
      } else {
        step = { kind: "done", answer: current.answer };
      }
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
