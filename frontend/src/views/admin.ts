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
        // before this UI stopped allowing that. Every other block's WHEN is
        // its own, independent slot — capture them all before any get
        // overwritten below, since q1's own WHEN would otherwise already be
        // gone by the time q1 itself is rebuilt.
        const mirrorFrom1 = (when: string) => ({
          ...JSON.parse(JSON.stringify(config.blocks["1"])),
          question: { ...config.blocks["1"].question, when },
        });
        const OTHER_BLOCKS = ["2", "combined", "q1", "q2", "q3", "q4"] as const;
        const whens = Object.fromEntries(OTHER_BLOCKS.map((block) => [block, config.blocks[block].question.when])) as Record<
          (typeof OTHER_BLOCKS)[number],
          string
        >;
        for (const block of OTHER_BLOCKS) config.blocks[block] = mirrorFrom1(whens[block]);

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
    "Every question asks the same thing and shares the WHY follow-up below — only each one's WHEN slot differs, and every block's WHEN slot is independent. Pick a cadence to edit its WHEN slot(s).";
  card.appendChild(note);

  const cadenceSelect = document.createElement("select");
  for (const [value, label] of [["twice", "Twice Daily"], ["once", "Once Daily"], ["four", "4x Daily"]] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    cadenceSelect.appendChild(opt);
  }
  card.appendChild(cadenceSelect);

  const whenFields = document.createElement("div");
  card.appendChild(whenFields);

  const whenField = (label: string, block: keyof AdminConfig["blocks"]) => {
    whenFields.appendChild(fieldLabel(label));
    whenFields.appendChild(textInput(config.blocks[block].question.when, (v) => (config.blocks[block].question.when = v)));
  };

  const renderWhenFields = () => {
    whenFields.innerHTML = "";
    if (cadenceSelect.value === "once") {
      whenField('Once Daily WHEN slot (e.g. "today go")', "combined");
    } else if (cadenceSelect.value === "four") {
      whenField('Morning WHEN slot (e.g. "today start")', "q1");
      whenField('Midday WHEN slot (e.g. "this morning go")', "q2");
      whenField('Afternoon WHEN slot (e.g. "this afternoon go")', "q3");
      whenField('Evening WHEN slot (e.g. "today end")', "q4");
    } else {
      whenField('Morning WHEN slot (e.g. "today start")', "1");
      whenField('Evening WHEN slot (e.g. "today end")', "2");
    }
  };
  cadenceSelect.addEventListener("change", renderWhenFields);
  renderWhenFields();

  // Morning's content is the shared source of truth for HOW/WHY, mirrored to every other block on save.
  const content = config.blocks["1"];

  card.appendChild(fieldLabel('HOW slot (e.g. "how you wanted")'));
  card.appendChild(textInput(content.question.how, (v) => (content.question.how = v)));

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
  const body = document.createElement("div");
  body.appendChild(textInput(invitation.how, (v) => (invitation.how = v), 'HOW slot (e.g. "how you wanted")'));

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
