import { api, LIVE_BLOCKS, type AdminConfig, type Category, type FollowupPrompt, type Invitation } from "../api";
import { BLOCK_LABEL, CATEGORY_LABEL } from "../blockCard";

export async function renderAdmin(root: HTMLElement): Promise<void> {
  root.innerHTML = `<h2>Admin</h2><div class="card">Loading…</div>`;
  try {
    const config = await api.getAdminConfig();
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Admin";
    root.appendChild(heading);

    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent = "Edits apply immediately on save — no redeploy needed. This is the canonical place to edit question content.";
    root.appendChild(intro);

    root.appendChild(renderQuestionSection(config));
    root.appendChild(renderTriggersSection(config));
    root.appendChild(renderRecommendationCopySection(config));

    const status = document.createElement("p");
    status.className = "muted";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save all changes";
    saveBtn.addEventListener("click", async () => {
      saveBtn.textContent = "Saving…";
      saveBtn.setAttribute("disabled", "true");
      try {
        // WHY (yes/no) still mirrors from q1 into q2-q4 on save — "1"/"2"/"combined" are frozen
        // legacy blocks (from the old cadence modes) and are deliberately left untouched, not
        // mirrored into. The question itself is NOT mirrored — each of q1-q4 is now a fully
        // independent, complete question, already directly edited in place above.
        const OTHER_BLOCKS = ["q2", "q3", "q4"] as const;
        for (const block of OTHER_BLOCKS) {
          config.blocks[block] = {
            question: config.blocks[block].question,
            yes: JSON.parse(JSON.stringify(config.blocks.q1.yes)),
            no: JSON.parse(JSON.stringify(config.blocks.q1.no)),
          };
        }

        await api.saveAdminConfig(config);
        status.textContent = "Saved.";
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : "Save failed.";
      }
      saveBtn.textContent = "Save all changes";
      saveBtn.removeAttribute("disabled");
    });
    root.appendChild(saveBtn);
    root.appendChild(status);
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load admin config.</div>`;
    console.error(err);
  }
}

function renderQuestionSection(config: AdminConfig): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const h = document.createElement("h3");
  h.textContent = "Question";
  card.appendChild(h);

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Each block's question is its own complete, independent sentence — write it exactly as it should read, since a user who's skipped the other three might see only this one on a given day. They share the WHY follow-up below.";
  card.appendChild(note);

  const questionField = (label: string, block: "q1" | "q2" | "q3" | "q4") => {
    card.appendChild(fieldLabel(label));
    card.appendChild(textInput(config.blocks[block].question, (v) => (config.blocks[block].question = v)));
  };

  questionField("Morning question", "q1");
  questionField("Midday question", "q2");
  questionField("Afternoon question", "q3");
  questionField("Evening question", "q4");

  // q1's WHY is the shared source of truth, mirrored to q2-q4 on save.
  const content = config.blocks.q1;

  for (const answer of ["yes", "no"] as const) {
    card.appendChild(renderFollowupEditor(content[answer], answer === "yes" ? "Yes → WHY" : "No → WHY"));
  }

  return card;
}

function renderFollowupEditor(prompt: FollowupPrompt, title: string): HTMLElement {
  const body = document.createElement("div");
  body.appendChild(textInput(prompt.prompt, (v) => (prompt.prompt = v), "Question text"));

  for (const cat of Object.keys(prompt.options) as Category[]) {
    body.appendChild(textInput(prompt.options[cat], (v) => (prompt.options[cat] = v), CATEGORY_LABEL[cat]));
  }

  return accordion(title, body);
}

/** A collapsed-by-default toggle around `body` — nesting one accordion's body inside another (invitation > follow-up) is what makes these "layered". */
function accordion(title: string, body: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "accordion";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "accordion-toggle";
  toggle.innerHTML = `<span>${title}</span><span class="chev">▾</span>`;

  body.classList.add("accordion-body");
  body.hidden = true;

  toggle.addEventListener("click", () => {
    const expanded = body.hidden;
    body.hidden = !expanded;
    toggle.classList.toggle("expanded", expanded);
  });

  wrap.append(toggle, body);
  return wrap;
}

function renderTriggersSection(config: AdminConfig): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Escalation & streak triggers";
  card.appendChild(h);

  card.appendChild(
    numberField("Exact-path repeat threshold", config.triggers.exactPathThreshold, (v) => (config.triggers.exactPathThreshold = v)),
  );
  card.appendChild(
    numberField("Category-volume threshold", config.triggers.categoryVolumeThreshold, (v) => (config.triggers.categoryVolumeThreshold = v)),
  );
  card.appendChild(numberField("Streak threshold (consecutive days)", config.triggers.streakThreshold, (v) => (config.triggers.streakThreshold = v)));
  card.appendChild(numberField("Retire an accepted suggestion after (days)", config.triggers.retireAfterDays, (v) => (config.triggers.retireAfterDays = v)));

  return card;
}

function renderRecommendationCopySection(config: AdminConfig): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Invitations to swap";
  card.appendChild(h);

  const p = document.createElement("p");
  p.className = "muted";
  p.textContent =
    "After a trigger fires, the user is invited to swap their question for one of these. Each invitation is four complete questions — one per block, since it can fire on whichever block the streak happened on — plus its own yes/no follow-ups. Up to 10 can fire: one per category for a yes-streak, one per category for a no-streak, and one each for a yes- or no-streak that isn't tied to any single category.";
  card.appendChild(p);

  for (const valence of ["amplify", "resolve"] as const) {
    const label = document.createElement("p");
    label.className = "muted";
    label.style.marginTop = "16px";
    label.style.fontWeight = "600";
    label.textContent = valence === "amplify" ? "Amplify — per-category yes-streaks" : "Resolve — per-category no-streaks";
    card.appendChild(label);
    for (const cat of Object.keys(config.recommendationCopy[valence]) as Category[]) {
      card.appendChild(renderInvitationEditor(config.recommendationCopy[valence][cat], CATEGORY_LABEL[cat]));
    }
  }

  const generalLabel = document.createElement("p");
  generalLabel.className = "muted";
  generalLabel.style.marginTop = "16px";
  generalLabel.style.fontWeight = "600";
  generalLabel.textContent = "General — streak with no single category behind it";
  card.appendChild(generalLabel);
  card.appendChild(renderInvitationEditor(config.recommendationCopy.generalYes, "Yes-streak, mixed categories"));
  card.appendChild(renderInvitationEditor(config.recommendationCopy.generalNo, "No-streak, mixed categories"));

  return card;
}

function renderInvitationEditor(invitation: Invitation, title: string): HTMLElement {
  const body = document.createElement("div");

  for (const block of LIVE_BLOCKS) {
    body.appendChild(fieldLabel(`${BLOCK_LABEL[block]} question`));
    body.appendChild(textInput(invitation.texts[block], (v) => (invitation.texts[block] = v)));
  }

  for (const answer of ["yes", "no"] as const) {
    body.appendChild(renderFollowupEditor(invitation[answer], answer === "yes" ? "Yes → WHY" : "No → WHY"));
  }

  return accordion(title, body);
}

function fieldLabel(text: string): HTMLElement {
  const label = document.createElement("label");
  label.className = "muted";
  label.textContent = text;
  label.style.display = "block";
  label.style.marginTop = "10px";
  return label;
}

function textInput(value: string, onChange: (v: string) => void, placeholder?: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function numberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.appendChild(fieldLabel(label));
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.value = String(value);
  input.addEventListener("input", () => onChange(parseInt(input.value, 10) || value));
  wrap.appendChild(input);
  return wrap;
}
