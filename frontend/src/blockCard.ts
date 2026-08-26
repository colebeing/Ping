import { api, type Answer, type BlockId, type Category, type FollowupPrompt, type FollowupVariant } from "./api";

export const BLOCK_LABEL: Record<BlockId, string> = { "1": "Morning", "2": "Evening" };
export const CATEGORY_LABEL: Record<Category, string> = { friends: "Friends", work: "Work", home: "Home", capacity: "Capacity" };

type Step =
  | { kind: "question" }
  | { kind: "followup"; answer: Answer; variant: FollowupVariant; prompt: FollowupPrompt }
  | { kind: "done"; answer: Answer; category: Category };

/**
 * The live, interactive yes/no + follow-up card for one block, for a given
 * date (defaults to today). Used by Today (the current block) and History
 * (every day shown, so old ones can be filled in too, not just viewed).
 * `onDone` fires once, the moment this block's category gets picked — lets a
 * caller react live (e.g. History unlocking Evening once Morning completes).
 */
export async function mountBlockCard(container: HTMLElement, block: BlockId, date?: string, onDone?: () => void): Promise<void> {
  container.innerHTML = `<div class="card">Loading…</div>`;
  try {
    const q = await api.getQuestion(block, date);
    let step: Step;

    if (!q.existingAnswer) {
      step = { kind: "question" };
    } else if (!q.existingAnswer.category) {
      // Answered yes/no already (e.g. from a notification action) but the
      // follow-up category wasn't picked yet — resume where it left off
      // instead of showing "done". Re-posting the same answer is a safe
      // no-op server-side and hands back the follow-up content we need.
      const res = await api.answer(block, q.existingAnswer.answer, date);
      step = { kind: "followup", answer: q.existingAnswer.answer, variant: res.followup.variant, prompt: res.followup };
    } else {
      step = { kind: "done", answer: q.existingAnswer.answer, category: q.existingAnswer.category };
      onDone?.();
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
        pill.textContent = step.answer === "yes" ? "Yes" : "No";
        card.appendChild(pill);
        const response = document.createElement("p");
        response.className = "muted";
        response.style.marginTop = "8px";
        response.textContent = CATEGORY_LABEL[step.category];
        card.appendChild(response);
        const edit = button("Edit", "btn", () => {
          step = { kind: "question" };
          paint();
        });
        card.appendChild(edit);
      }

      container.innerHTML = "";
      container.appendChild(card);
    };

    const submitAnswer = async (answer: Answer) => {
      const res = await api.answer(block, answer, date);
      step = { kind: "followup", answer, variant: res.followup.variant, prompt: res.followup };
      paint();
    };

    const submitFollowup = async (current: Extract<Step, { kind: "followup" }>, category: Category) => {
      await api.followup(block, category, date);
      step = { kind: "done", answer: current.answer, category };
      paint();
      onDone?.();
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
