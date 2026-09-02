import { api, type AdminConfig, type Category, type FollowupPrompt, type Invitation } from "../api";
import { CATEGORY_LABEL } from "../blockCard";

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
    intro.textContent = "Edits apply immediately on save — no redeploy needed. Question content here is also editable via the Google Sheet + npm run seed-from-sheet; whichever you use last wins.";
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
        // Every block only ever differs from block "1" by its own WHEN slot —
        // keep HOW/WHY mirrored to "1" on save, in case they'd drifted apart
        // before this UI stopped allowing that. Start of day (q1) and End of
        // day (q4) mirror "1"'s and "2"'s WHEN exactly (no field of their
        // own); Morning (q2) and Afternoon (q3) keep their own WHEN, captured
        // before being overwritten below.
        const mirrorFrom1 = (when: string) => ({
          ...JSON.parse(JSON.stringify(config.blocks["1"])),
          question: { ...config.blocks["1"].question, when },
        });
        const morningWhen = config.blocks["1"].question.when;
        const eveningWhen = config.blocks["2"].question.when;
        const combinedWhen = config.blocks.combined.question.when;
        const q2When = config.blocks.q2.question.when;
        const q3When = config.blocks.q3.question.when;

        config.blocks["2"] = mirrorFrom1(eveningWhen);
        config.blocks.combined = mirrorFrom1(combinedWhen);
        config.blocks.q1 = mirrorFrom1(morningWhen);
        config.blocks.q2 = mirrorFrom1(q2When);
        config.blocks.q3 = mirrorFrom1(q3When);
        config.blocks.q4 = mirrorFrom1(eveningWhen);

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
    "Every question asks the same thing and shares the WHY follow-up — only each one's WHEN slot differs. 4x Daily's Start of day and End of day mirror Morning/Evening exactly; Morning and Afternoon below are their own slots, just for 4x Daily.";
  card.appendChild(note);

  // Morning's content is the shared source of truth; every other block keeps its own WHEN only (mirrored on save).
  const content = config.blocks["1"];

  card.appendChild(fieldLabel('Morning WHEN slot (e.g. "today start") — also 4x Daily\'s Start of day'));
  card.appendChild(textInput(content.question.when, (v) => (content.question.when = v)));
  card.appendChild(fieldLabel('Evening WHEN slot (e.g. "today end") — also 4x Daily\'s End of day'));
  card.appendChild(textInput(config.blocks["2"].question.when, (v) => (config.blocks["2"].question.when = v)));
  card.appendChild(fieldLabel('Once Daily WHEN slot (e.g. "today go")'));
  card.appendChild(textInput(config.blocks.combined.question.when, (v) => (config.blocks.combined.question.when = v)));
  card.appendChild(fieldLabel('4x Daily — Morning WHEN slot (e.g. "this morning go")'));
  card.appendChild(textInput(config.blocks.q2.question.when, (v) => (config.blocks.q2.question.when = v)));
  card.appendChild(fieldLabel('4x Daily — Afternoon WHEN slot (e.g. "this afternoon go")'));
  card.appendChild(textInput(config.blocks.q3.question.when, (v) => (config.blocks.q3.question.when = v)));

  card.appendChild(fieldLabel('HOW slot (e.g. "how you wanted")'));
  card.appendChild(textInput(content.question.how, (v) => (content.question.how = v)));

  for (const answer of ["yes", "no"] as const) {
    card.appendChild(renderFollowupEditor(content[answer], answer === "yes" ? "Yes → WHY" : "No → WHY"));
  }

  return card;
}

function renderFollowupEditor(prompt: FollowupPrompt, title: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "16px";
  wrap.style.paddingTop = "12px";
  wrap.style.borderTop = "1px solid var(--surface-2)";

  const label = document.createElement("p");
  label.className = "muted";
  label.textContent = title;
  wrap.appendChild(label);

  wrap.appendChild(textInput(prompt.prompt, (v) => (prompt.prompt = v), "Question text"));

  for (const cat of Object.keys(prompt.options) as Category[]) {
    wrap.appendChild(textInput(prompt.options[cat], (v) => (prompt.options[cat] = v), CATEGORY_LABEL[cat]));
  }

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
    "After a trigger fires, the user is invited to swap their HOW question for one of these. Each is a full question, just like the starter question above — its own HOW slot plus yes/no follow-ups. Up to 10 can fire: one per category for a yes-streak, one per category for a no-streak, and one each for a yes- or no-streak that isn't tied to any single category.";
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
  const wrap = document.createElement("div");
  wrap.style.marginTop = "10px";
  wrap.style.paddingTop = "10px";
  wrap.style.paddingLeft = "12px";
  wrap.style.borderLeft = "3px solid var(--surface-2)";

  const label = document.createElement("p");
  label.className = "muted";
  label.textContent = title;
  wrap.appendChild(label);

  wrap.appendChild(textInput(invitation.how, (v) => (invitation.how = v), 'HOW slot (e.g. "how you wanted")'));

  for (const answer of ["yes", "no"] as const) {
    wrap.appendChild(renderFollowupEditor(invitation[answer], answer === "yes" ? "Yes → WHY" : "No → WHY"));
  }

  return wrap;
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
