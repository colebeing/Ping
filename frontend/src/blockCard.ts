import { api, type Answer, type BlockId, type Category, type FollowupPrompt, type Recommendation } from "./api";

export const BLOCK_LABEL: Record<BlockId, string> = {
  "1": "Morning",
  "2": "Evening",
  combined: "Today",
  q1: "Morning",
  q2: "Midday",
  q3: "Afternoon",
  q4: "Evening",
};
export const CATEGORY_LABEL: Record<Category, string> = { friends: "Friends", colleagues: "Colleagues", family: "Family", me: "Me" };

interface DoneStep {
  kind: "done";
  answer: Answer;
  category: Category;
  followupPrompt: string;
  optionLabel: string;
}

type Step =
  | { kind: "question" }
  | { kind: "followup"; answer: Answer; prompt: FollowupPrompt }
  // A bonus third tap after the normal check-in + follow-up, only shown when
  // a streak just crossed threshold: the invitation's own question, answered
  // Yes to swap the block's HOW going forward or No to keep things as-is.
  | { kind: "recommendation"; recommendation: Recommendation; next: DoneStep }
  | DoneStep;

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
      step = { kind: "followup", answer: q.existingAnswer.answer, prompt: res.followup };
    } else {
      const doneStep: DoneStep = {
        kind: "done",
        answer: q.existingAnswer.answer,
        category: q.existingAnswer.category,
        followupPrompt: q.existingAnswer.followup?.prompt ?? "",
        optionLabel: q.existingAnswer.followup?.optionLabel ?? CATEGORY_LABEL[q.existingAnswer.category],
      };
      // Recovers an invitation that fired but wasn't resolved before a reload
      // (closed the app, refreshed) — otherwise it only ever showed up once,
      // transiently, right after the follow-up call that created it.
      step = q.pendingRecommendation ? { kind: "recommendation", recommendation: q.pendingRecommendation, next: doneStep } : doneStep;
      onDone?.();
    }

    const paint = () => {
      const card = document.createElement("div");
      card.className = "card block-card";

      const header = document.createElement("div");
      header.className = "block-header";

      const label = document.createElement("span");
      label.className = "pill";
      label.textContent = BLOCK_LABEL[block];
      header.appendChild(label);

      const question = document.createElement("span");
      question.className = "block-question";
      question.textContent = q.text;
      header.appendChild(question);

      if (step.kind === "done") {
        const edit = document.createElement("button");
        edit.className = "icon-btn";
        edit.setAttribute("aria-label", "Edit");
        edit.textContent = "✏️";
        edit.addEventListener("click", () => {
          step = { kind: "question" };
          paint();
        });
        header.appendChild(edit);
      }

      card.appendChild(header);

      if (step.kind === "question") {
        const row = document.createElement("div");
        row.className = "btn-row";
        const yes = button("Yes", "btn btn-primary", () => submitAnswer("yes"));
        const no = button("No", "btn", () => submitAnswer("no"));
        row.append(yes, no);
        card.appendChild(row);
      } else if (step.kind === "followup") {
        const p = document.createElement("p");
        p.className = "followup-prompt";
        p.textContent = step.prompt.prompt;
        card.appendChild(p);
        const grid = document.createElement("div");
        grid.className = "option-grid";
        for (const cat of Object.keys(CATEGORY_LABEL) as Category[]) {
          grid.appendChild(button(step.prompt.options[cat], "btn", () => submitFollowup(step as Extract<Step, { kind: "followup" }>, cat)));
        }
        card.appendChild(grid);
      } else if (step.kind === "recommendation") {
        const wrap = document.createElement("div");
        wrap.className = "recommendation-prompt";

        const badge = document.createElement("span");
        badge.className = "pill recommendation-badge";
        badge.textContent = "Noticed a pattern";
        wrap.appendChild(badge);

        const proposed = document.createElement("p");
        proposed.className = "followup-prompt";
        proposed.textContent = `Did ${q.when} ${step.recommendation.invitation.how}?`;
        wrap.appendChild(proposed);

        const row = document.createElement("div");
        row.className = "btn-row";
        const current = step as Extract<Step, { kind: "recommendation" }>;
        row.append(
          button("Yes, make this my question", "btn btn-primary", () => resolveRecommendation(current, true)),
          button("No, keep mine", "btn", () => resolveRecommendation(current, false)),
        );
        wrap.appendChild(row);

        card.appendChild(wrap);
      } else {
        const answerRow = document.createElement("div");
        answerRow.className = "answer-row";
        const badge = document.createElement("span");
        badge.className = `answer-badge answered-${step.answer}`;
        badge.textContent = step.answer === "yes" ? "Yes" : "No";
        answerRow.appendChild(badge);

        if (step.followupPrompt) {
          const followupLine = document.createElement("span");
          followupLine.className = "followup-line";
          const fq = document.createElement("span");
          fq.className = "followup-q";
          fq.textContent = step.followupPrompt;
          const fa = document.createElement("strong");
          fa.textContent = step.optionLabel;
          followupLine.append(fq, " ", fa);
          answerRow.appendChild(followupLine);
        }

        card.appendChild(answerRow);
      }

      container.innerHTML = "";
      container.appendChild(card);
    };

    const submitAnswer = async (answer: Answer) => {
      const res = await api.answer(block, answer, date);
      step = { kind: "followup", answer, prompt: res.followup };
      paint();
    };

    const submitFollowup = async (current: Extract<Step, { kind: "followup" }>, category: Category) => {
      const res = await api.followup(block, category, date);
      const doneStep: DoneStep = {
        kind: "done",
        answer: current.answer,
        category,
        followupPrompt: current.prompt.prompt,
        optionLabel: current.prompt.options[category],
      };
      const recommendation = res.newRecommendations.find((r) => r.block === block);
      step = recommendation ? { kind: "recommendation", recommendation, next: doneStep } : doneStep;
      paint();
      onDone?.();
    };

    const resolveRecommendation = async (current: Extract<Step, { kind: "recommendation" }>, accept: boolean) => {
      if (accept) await api.acceptRecommendation(current.recommendation.id);
      else await api.declineRecommendation(current.recommendation.id);
      step = current.next;
      paint();
    };

    paint();
  } catch (err) {
    container.innerHTML = `<div class="card error">Couldn't load this block.</div>`;
    console.error(err);
  }
}

export function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}
