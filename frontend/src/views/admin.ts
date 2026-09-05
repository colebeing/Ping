import {
  api,
  type AdminConfig,
  type Category,
  type EscalationChildren,
  type EscalationNode,
  type EscalationPath,
  type EscalationStep,
  type FollowupPrompt,
  type QuestionRoot,
} from "../api";
import { CATEGORY_LABEL } from "../blockCard";

const CATEGORY_ORDER: Category[] = ["friends", "colleagues", "family", "me"];
const ROOT_BLOCK_FIELDS = [
  ["Morning", "q1"],
  ["Midday", "q2"],
  ["Afternoon", "q3"],
  ["Evening", "q4"],
] as const;

function emptyFollowup(): FollowupPrompt {
  return { prompt: "", options: { friends: "", colleagues: "", family: "", me: "" } };
}

function emptyNode(): EscalationNode {
  return { question: "", yes: emptyFollowup(), no: emptyFollowup(), children: { amplify: {}, resolve: {} } };
}

function childAt(children: EscalationChildren, step: EscalationStep): EscalationNode | undefined {
  return step.category === null ? (step.valence === "amplify" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
}

function setChildAt(children: EscalationChildren, step: EscalationStep, node: EscalationNode): void {
  if (step.category === null) {
    if (step.valence === "amplify") children.generalYes = node;
    else children.generalNo = node;
  } else {
    children[step.valence][step.category] = node;
  }
}

/** Walks the tree from the root along `path` — mirrors backend/src/recommendations.ts's resolveNode. */
function resolveNode(root: QuestionRoot, path: EscalationPath): EscalationNode | null {
  let node: EscalationNode | null = null;
  let children: EscalationChildren = root.children;
  for (const step of path) {
    const next = childAt(children, step);
    if (!next) return null;
    node = next;
    children = next.children;
  }
  return node;
}

function stepLabel(step: EscalationStep): string {
  if (step.category === null) return step.valence === "amplify" ? "Mixed (yes-streak)" : "Mixed (no-streak)";
  return CATEGORY_LABEL[step.category];
}

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

    const treeCard = document.createElement("div");
    root.appendChild(treeCard);

    let currentPath: EscalationPath = [];
    const navigate = (path: EscalationPath) => {
      currentPath = path;
      renderTree();
    };
    const renderTree = () => {
      treeCard.innerHTML = "";
      treeCard.appendChild(renderNodeEditor(config.questionRoot, currentPath, navigate));
    };
    renderTree();

    root.appendChild(renderTriggersSection(config));

    const status = document.createElement("p");
    status.className = "muted";

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save all changes";
    saveBtn.addEventListener("click", async () => {
      saveBtn.textContent = "Saving…";
      saveBtn.setAttribute("disabled", "true");
      try {
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

/**
 * Every node in the escalation tree — root included — gets the identical editor shape: its own
 * question field(s), its own shared yes/no follow-up, and two branch groups of 5 leaves each
 * (Friends/Colleagues/Family/Me/Mixed, once for the Yes-path and once for the No-path). Only the
 * question field itself varies: 4 per-block texts at the root, 1 block-agnostic text everywhere
 * deeper. `navigate` re-renders this same card at a different path — see renderAdmin's `renderTree`.
 */
function renderNodeEditor(root: QuestionRoot, path: EscalationPath, navigate: (path: EscalationPath) => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const crumbs = document.createElement("div");
  crumbs.className = "breadcrumbs";
  crumbs.appendChild(breadcrumb("Routine question", path.length === 0, () => navigate([])));
  for (let i = 0; i < path.length; i++) {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep";
    sep.textContent = "/";
    crumbs.appendChild(sep);
    const target = path.slice(0, i + 1);
    crumbs.appendChild(breadcrumb(stepLabel(path[i]), i === path.length - 1, () => navigate(target)));
  }
  card.appendChild(crumbs);

  const node = path.length === 0 ? null : resolveNode(root, path);
  if (path.length > 0 && !node) {
    const err = document.createElement("p");
    err.className = "error";
    err.textContent = "This node couldn't be found — it may have been removed elsewhere.";
    card.appendChild(err);
    return card;
  }

  const h = document.createElement("h3");
  h.textContent = path.length === 0 ? "Routine question" : `Swap invite: ${stepLabel(path[path.length - 1])}`;
  card.appendChild(h);

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    path.length === 0
      ? "Each block's question is its own complete, independent sentence — write it exactly as it should read, since a user who's skipped the other three might see only this one on a given day."
      : "One complete, block-agnostic question — this swap invite can fire on whichever block the streak happened on, so it doesn't reference a time of day.";
  card.appendChild(note);

  if (path.length === 0) {
    for (const [label, block] of ROOT_BLOCK_FIELDS) {
      card.appendChild(fieldLabel(`${label} question`));
      card.appendChild(textInput(root.blockQuestions[block], (v) => (root.blockQuestions[block] = v)));
    }
  } else {
    card.appendChild(fieldLabel("Question"));
    card.appendChild(textInput(node!.question, (v) => (node!.question = v)));
  }

  const followupNote = document.createElement("p");
  followupNote.className = "muted";
  followupNote.style.marginTop = "16px";
  followupNote.textContent = "Follow-up, asked right after answering:";
  card.appendChild(followupNote);

  const yes = path.length === 0 ? root.yes : node!.yes;
  const no = path.length === 0 ? root.no : node!.no;
  card.appendChild(renderFollowupEditor(yes, "Yes → WHY"));
  card.appendChild(renderFollowupEditor(no, "No → WHY"));

  const children = path.length === 0 ? root.children : node!.children;
  card.appendChild(renderBranchGroup("Yes-path swap invites", "amplify", children, path, navigate));
  card.appendChild(renderBranchGroup("No-path swap invites", "resolve", children, path, navigate));

  return card;
}

function breadcrumb(label: string, isCurrent: boolean, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "breadcrumb" + (isCurrent ? " current" : "");
  btn.textContent = label;
  if (!isCurrent) btn.addEventListener("click", onClick);
  return btn;
}

function renderBranchGroup(
  title: string,
  valence: "amplify" | "resolve",
  children: EscalationChildren,
  path: EscalationPath,
  navigate: (path: EscalationPath) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "16px";

  const label = document.createElement("p");
  label.className = "muted";
  label.style.fontWeight = "600";
  label.textContent = title;
  wrap.appendChild(label);

  for (const cat of CATEGORY_ORDER) {
    wrap.appendChild(renderLeaf(CATEGORY_LABEL[cat], { valence, category: cat }, children, path, navigate));
  }
  wrap.appendChild(renderLeaf("Mixed", { valence, category: null }, children, path, navigate));

  return wrap;
}

function renderLeaf(
  label: string,
  step: EscalationStep,
  children: EscalationChildren,
  path: EscalationPath,
  navigate: (path: EscalationPath) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "leaf-row";

  const labelEl = document.createElement("span");
  labelEl.className = "leaf-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const existing = childAt(children, step);
  if (existing) {
    const preview = document.createElement("p");
    preview.className = "leaf-preview muted";
    preview.textContent = existing.question || "(no question text yet)";
    row.appendChild(preview);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "link-btn";
    openBtn.textContent = "Open →";
    openBtn.addEventListener("click", () => navigate([...path, step]));
    row.appendChild(openBtn);
  } else {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "link-btn";
    addBtn.textContent = "Not yet configured — add a swap invite";
    addBtn.addEventListener("click", () => {
      setChildAt(children, step, emptyNode());
      navigate([...path, step]);
    });
    row.appendChild(addBtn);
  }

  return row;
}

function renderFollowupEditor(prompt: FollowupPrompt, title: string): HTMLElement {
  const body = document.createElement("div");
  body.appendChild(textInput(prompt.prompt, (v) => (prompt.prompt = v), "Question text"));

  for (const cat of Object.keys(prompt.options) as Category[]) {
    body.appendChild(textInput(prompt.options[cat], (v) => (prompt.options[cat] = v), CATEGORY_LABEL[cat]));
  }

  return accordion(title, body);
}

/** A collapsed-by-default toggle around `body` — nesting one accordion's body inside another (a
 * follow-up nested inside the node editor) is what makes these "layered". */
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
