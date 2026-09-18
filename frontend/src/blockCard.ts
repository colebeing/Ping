import { api, type Answer, type BlockId, type Category, type FollowupPrompt, type RecommendationNudge } from "./api";

export const BLOCK_LABEL: Record<BlockId, string> = {
  "1": "Morning",
  "2": "Evening",
  combined: "Today",
  q1: "Morning",
  q2: "Midday",
  q3: "Afternoon",
  q4: "Evening",
};
export const CATEGORY_LABEL: Record<Category, string> = { environment: "Environment", people: "People", impact: "Impact", capacity: "Capacity" };
/** The one place category display order is decided — derived from CATEGORY_LABEL above so there's
 * only one list to keep in sync, not a second copy of the four keys elsewhere in the frontend. */
export const CATEGORY_ORDER: Category[] = Object.keys(CATEGORY_LABEL) as Category[];

interface DoneStep {
  kind: "done";
  answer: Answer;
  category: Category;
  followupPrompt: string;
  optionLabel: string;
  /** Set only once resolved (accepted/declined) — a still-open one uses the separate "recommendation"
   * step instead, since that's the interactive accept/decline card, not this plain display. Stays
   * attached indefinitely (see api.ts's QuestionResponse), so a declined or long-since-accepted
   * invitation is still visible, and a declined one still actionable, whenever this exact answer is
   * viewed again — today, or years later in History. */
  recommendation?: RecommendationNudge;
}

type Step =
  | { kind: "question" }
  | { kind: "followup"; answer: Answer; prompt: FollowupPrompt }
  // A bonus third tap after the normal check-in + follow-up, only shown when
  // a streak just crossed threshold: the invitation's own question, answered
  // Yes to swap the block's HOW going forward or No to keep things as-is.
  | { kind: "recommendation"; recommendation: RecommendationNudge; next: DoneStep }
  // Only reached from "recommendation" when the invitation's own node has a digIn — a one-time pick
  // among up to 4 admin-defined options before the swap actually takes effect. See DigIn's doc comment.
  | { kind: "digIn"; recommendation: RecommendationNudge; next: DoneStep }
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
        recommendation: q.recommendation && q.recommendation.status !== "pending" ? q.recommendation : undefined,
      };
      // A still-open invitation (fired but never resolved, whether that's from seconds or months ago)
      // gets the interactive accept/decline card; an already-resolved one is just attached to doneStep
      // above for display instead.
      step = q.recommendation?.status === "pending" ? { kind: "recommendation", recommendation: q.recommendation, next: doneStep } : doneStep;
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
        for (const cat of CATEGORY_ORDER) {
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
        proposed.textContent = step.recommendation.node.inviteQuestion;
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
      } else if (step.kind === "digIn") {
        const digIn = step.recommendation.node.digIn!;
        const wrap = document.createElement("div");
        wrap.className = "recommendation-prompt";

        const badge = document.createElement("span");
        badge.className = "pill recommendation-badge";
        badge.textContent = "Noticed a pattern";
        wrap.appendChild(badge);

        const prompt = document.createElement("p");
        prompt.className = "followup-prompt";
        prompt.textContent = digIn.prompt;
        wrap.appendChild(prompt);

        const grid = document.createElement("div");
        grid.className = "option-grid";
        const current = step as Extract<Step, { kind: "digIn" }>;
        digIn.options.forEach((option, index) => {
          if (!option.label) return;
          grid.appendChild(button(option.label, "btn", () => chooseDigIn(current, index)));
        });
        wrap.appendChild(grid);

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

        // Whatever swap invitation this answer earned, stays visible right alongside it rather than
        // vanishing the moment it's resolved — deliberately plain here (no badge, no "you missed this"
        // framing), just the fact of what was offered and what happened. A declined one keeps a single,
        // low-key way to change course, since "earned but said no to at the time" isn't the same as
        // "never allowed to happen" — the whole point of keeping this around at all.
        if (step.recommendation) {
          const rec = step.recommendation;
          const recWrap = document.createElement("div");
          recWrap.className = "recommendation-prompt recommendation-resolved";

          const q = document.createElement("p");
          q.className = "followup-prompt";
          q.textContent = rec.node.inviteQuestion;
          recWrap.appendChild(q);

          const status = document.createElement("p");
          status.className = "muted";
          status.textContent = rec.status === "accepted" ? "This became your question." : "You said no to this.";
          recWrap.appendChild(status);

          if (rec.status === "declined") {
            recWrap.appendChild(button("Make this my question", "btn", () => activateRecommendation(step as DoneStep, rec)));
          }

          card.appendChild(recWrap);
        }
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
      if (!accept) {
        await api.declineRecommendation(current.recommendation.id);
        step = { ...current.next, recommendation: { ...current.recommendation, status: "declined" } };
        paint();
        return;
      }
      // A digIn node can't be accepted blindly — ask which of its up to 4 options first, the actual
      // accept only happens once one is picked (chooseDigIn below).
      if (current.recommendation.node.digIn) {
        step = { kind: "digIn", recommendation: current.recommendation, next: current.next };
        paint();
        return;
      }
      await api.acceptRecommendation(current.recommendation.id);
      step = { ...current.next, recommendation: { ...current.recommendation, status: "accepted" } };
      paint();
    };

    const chooseDigIn = async (current: Extract<Step, { kind: "digIn" }>, index: number) => {
      await api.acceptRecommendation(current.recommendation.id, index);
      step = { ...current.next, recommendation: { ...current.recommendation, status: "accepted" } };
      paint();
    };

    // Reactivates a declined (or, in principle, long-pending) invitation straight from its resolved,
    // attached-to-doneStep display — same acceptance path a live "recommendation" step uses, just
    // entered from history instead of the moment it fired.
    const activateRecommendation = async (current: DoneStep, rec: RecommendationNudge) => {
      if (rec.node.digIn) {
        step = { kind: "digIn", recommendation: rec, next: current };
        paint();
        return;
      }
      await api.acceptRecommendation(rec.id);
      step = { ...current, recommendation: { ...rec, status: "accepted" } };
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
