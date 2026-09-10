import {
  api,
  type AdminConfig,
  type Category,
  type DigIn,
  type DigInOption,
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
  return {
    inviteQuestion: "",
    blockQuestions: { q1: "", q2: "", q3: "", q4: "" },
    yes: emptyFollowup(),
    no: emptyFollowup(),
    children: { amplify: {}, resolve: {} },
  };
}

function emptyDigInOption(): DigInOption {
  return { label: "", blockQuestions: { q1: "", q2: "", q3: "", q4: "" } };
}

function emptyDigIn(): DigIn {
  return { prompt: "", options: [emptyDigInOption(), emptyDigInOption(), emptyDigInOption(), emptyDigInOption()] };
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

/** A step's true label is whatever the PARENT node's own yes/no follow-up option text says for that
 * category — the literal button text a real end-user taps — not a fixed generic name, since admins can
 * customize that text per node. Falls back to CATEGORY_LABEL only while the option text is genuinely
 * still blank. The "Mixed" (general) slots aren't tied to one category, so they keep fixed text. */
function dynamicStepLabel(step: EscalationStep, parentYes: FollowupPrompt, parentNo: FollowupPrompt): string {
  if (step.category === null) return step.valence === "amplify" ? "Mixed (yes-streak)" : "Mixed (no-streak)";
  const prompt = step.valence === "amplify" ? parentYes : parentNo;
  return prompt.options[step.category] || CATEGORY_LABEL[step.category];
}

/** The 10 possible child slots off any node, in the same fixed order the map's columns and the tree
 * editor's two branch groups both use. */
const SLOTS: EscalationStep[] = [
  ...CATEGORY_ORDER.map((category) => ({ valence: "amplify" as const, category })),
  { valence: "amplify" as const, category: null },
  ...CATEGORY_ORDER.map((category) => ({ valence: "resolve" as const, category })),
  { valence: "resolve" as const, category: null },
];

interface MapRow {
  path: EscalationPath;
  label: string;
  questionPreview: string;
}

/** Depth-first walk collecting every AUTHORED node (root always included, since it always exists) —
 * an unauthored slot never gets a row of its own, only a gap indicator on its parent's row. */
function collectRows(root: QuestionRoot): MapRow[] {
  const rootPreview = `${root.blockQuestions.q1} (+3 more)`;
  const rows: MapRow[] = [{ path: [], label: "Routine question", questionPreview: rootPreview }];

  // Carries each step's own parent yes/no down the walk (needed for dynamicStepLabel) and the labels
  // built so far (joined for display, same as the old flat childPath.map(stepLabel).join(" → ")).
  const walk = (children: EscalationChildren, path: EscalationPath, parentYes: FollowupPrompt, parentNo: FollowupPrompt, priorLabels: string[]) => {
    for (const step of SLOTS) {
      const child = childAt(children, step);
      if (!child) continue;
      const childPath = [...path, step];
      const labels = [...priorLabels, dynamicStepLabel(step, parentYes, parentNo)];
      rows.push({ path: childPath, label: labels.join(" → "), questionPreview: child.inviteQuestion });
      walk(child.children, childPath, child.yes, child.no, labels);
    }
  };
  walk(root.children, [], root.yes, root.no, []);
  return rows;
}

interface DiffEntry {
  path: EscalationPath;
  label: string;
  kind: "added" | "removed" | "changed";
  changes: string[];
}

function diffField(label: string, from: string, to: string, changes: string[]): void {
  if (from !== to) changes.push(`${label}: "${from || "(blank)"}" → "${to || "(blank)"}"`);
}

function diffFollowup(prefix: string, from: FollowupPrompt, to: FollowupPrompt, changes: string[]): void {
  diffField(`${prefix} prompt`, from.prompt, to.prompt, changes);
  for (const cat of CATEGORY_ORDER) diffField(`${prefix} ${CATEGORY_LABEL[cat]}`, from.options[cat], to.options[cat], changes);
}

function diffBlockQuestions(prefix: string, from: Record<string, string>, to: Record<string, string>, changes: string[]): void {
  for (const [label, block] of ROOT_BLOCK_FIELDS) diffField(`${prefix}${label}`, from[block], to[block], changes);
}

/** Field-level diff for one node — blockQuestions is skipped when either side has a digIn (superseded
 * by whichever option is picked, comparing it would just be noise), compared per-option instead. */
function diffNode(from: EscalationNode, to: EscalationNode): string[] {
  const changes: string[] = [];
  diffField("Swap invite", from.inviteQuestion, to.inviteQuestion, changes);
  if (!from.digIn && !to.digIn) {
    diffBlockQuestions("", from.blockQuestions, to.blockQuestions, changes);
  } else if (!from.digIn && to.digIn) {
    changes.push("Follow-up: added");
  } else if (from.digIn && !to.digIn) {
    changes.push("Follow-up: removed");
  } else if (from.digIn && to.digIn) {
    diffField("Follow-up prompt", from.digIn.prompt, to.digIn.prompt, changes);
    from.digIn.options.forEach((option, i) => {
      const toOption = to.digIn!.options[i];
      diffField(`Option ${i + 1} label`, option.label, toOption.label, changes);
      diffBlockQuestions(`Option ${i + 1} `, option.blockQuestions, toOption.blockQuestions, changes);
    });
  }
  diffFollowup("Yes", from.yes, to.yes, changes);
  diffFollowup("No", from.no, to.no, changes);
  return changes;
}

/**
 * Every path present in either tree, one entry per node that's new, removed, or has at least one
 * changed field — same SLOTS-based walk collectRows uses, just comparing two trees in lockstep instead
 * of reading one. An added/removed node is reported once, not recursed into (everything under it is
 * implicitly new/gone too — keeping the review list itself reviewable).
 */
function diffQuestionRoots(current: QuestionRoot, candidate: QuestionRoot): DiffEntry[] {
  const entries: DiffEntry[] = [];

  const rootChanges: string[] = [];
  diffBlockQuestions("", current.blockQuestions, candidate.blockQuestions, rootChanges);
  diffFollowup("Yes", current.yes, candidate.yes, rootChanges);
  diffFollowup("No", current.no, candidate.no, rootChanges);
  if (rootChanges.length > 0) entries.push({ path: [], label: "Routine question", kind: "changed", changes: rootChanges });

  const walk = (
    curChildren: EscalationChildren,
    candChildren: EscalationChildren,
    path: EscalationPath,
    curParentYes: FollowupPrompt,
    curParentNo: FollowupPrompt,
    priorLabels: string[],
  ) => {
    for (const step of SLOTS) {
      const curNode = childAt(curChildren, step);
      const candNode = childAt(candChildren, step);
      if (!curNode && !candNode) continue;
      const labels = [...priorLabels, dynamicStepLabel(step, curParentYes, curParentNo)];
      const childPath = [...path, step];
      if (curNode && candNode) {
        const changes = diffNode(curNode, candNode);
        if (changes.length > 0) entries.push({ path: childPath, label: labels.join(" → "), kind: "changed", changes });
        walk(curNode.children, candNode.children, childPath, curNode.yes, curNode.no, labels);
      } else if (candNode) {
        entries.push({ path: childPath, label: labels.join(" → "), kind: "added", changes: [] });
      } else if (curNode) {
        entries.push({ path: childPath, label: labels.join(" → "), kind: "removed", changes: [] });
      }
    }
  };
  walk(current.children, candidate.children, [], current.yes, current.no, []);
  return entries;
}

/** Push writes the whole live tree out (a full replace, KV is always the source of truth on that
 * direction); Pull reads it back but never writes to KV itself — it hands back a candidate tree the
 * admin reviews via diffQuestionRoots before "Apply" replaces config.questionRoot in memory, same as
 * any other edit (still needs the page's own "Save all changes" to actually go live). */
function renderSheetSyncSection(
  pushStatus: string,
  pullStatus: string,
  pullPreview: { root: QuestionRoot; diff: DiffEntry[] } | null,
  handlers: { onPush: () => void; onPull: () => void; onApply: () => void; onCancel: () => void },
): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const h = document.createElement("h3");
  h.textContent = "Google Sheet sync";
  card.appendChild(h);

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Push writes the current tree out to the configured Google Sheet. Pull reads it back and shows exactly what would change before anything here is touched.";
  card.appendChild(note);

  const pushRow = document.createElement("div");
  const pushBtn = document.createElement("button");
  pushBtn.type = "button";
  pushBtn.className = "btn";
  pushBtn.textContent = "Push to Sheet";
  pushBtn.addEventListener("click", handlers.onPush);
  pushRow.appendChild(pushBtn);
  const pushStatusEl = document.createElement("span");
  pushStatusEl.className = "muted";
  pushStatusEl.style.marginLeft = "8px";
  pushStatusEl.textContent = pushStatus;
  pushRow.appendChild(pushStatusEl);
  card.appendChild(pushRow);

  const pullRow = document.createElement("div");
  pullRow.style.marginTop = "10px";
  const pullBtn = document.createElement("button");
  pullBtn.type = "button";
  pullBtn.className = "btn";
  pullBtn.textContent = "Pull from Sheet";
  pullBtn.addEventListener("click", handlers.onPull);
  pullRow.appendChild(pullBtn);
  const pullStatusEl = document.createElement("span");
  pullStatusEl.className = "muted";
  pullStatusEl.style.marginLeft = "8px";
  pullStatusEl.textContent = pullStatus;
  pullRow.appendChild(pullStatusEl);
  card.appendChild(pullRow);

  if (pullPreview) {
    const preview = document.createElement("div");
    preview.style.marginTop = "16px";

    if (pullPreview.diff.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No differences — the Sheet matches what's already live.";
      preview.appendChild(p);
    } else {
      const summary = document.createElement("p");
      summary.className = "muted";
      summary.style.fontWeight = "600";
      summary.textContent = `${pullPreview.diff.length} node${pullPreview.diff.length === 1 ? "" : "s"} would change:`;
      preview.appendChild(summary);

      for (const entry of pullPreview.diff) {
        const body = document.createElement("div");
        if (entry.changes.length > 0) {
          for (const change of entry.changes) {
            const p = document.createElement("p");
            p.className = "muted";
            p.textContent = change;
            body.appendChild(p);
          }
        } else {
          const p = document.createElement("p");
          p.className = "muted";
          p.textContent = entry.kind === "added" ? "This whole node is new." : "This whole node would be removed.";
          body.appendChild(p);
        }
        const titlePrefix = entry.kind === "added" ? "New: " : entry.kind === "removed" ? "Removed: " : "";
        preview.appendChild(accordion(`${titlePrefix}${entry.label}`, body));
      }
    }

    const actionRow = document.createElement("div");
    actionRow.className = "btn-row";
    actionRow.style.marginTop = "10px";
    if (pullPreview.diff.length > 0) {
      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "btn btn-primary";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", handlers.onApply);
      actionRow.appendChild(applyBtn);
    }
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", handlers.onCancel);
    actionRow.appendChild(cancelBtn);
    preview.appendChild(actionRow);

    card.appendChild(preview);
  }

  return card;
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

    const mapCard = document.createElement("div");
    root.appendChild(mapCard);

    const treeCard = document.createElement("div");
    root.appendChild(treeCard);

    let currentPath: EscalationPath = [];
    // Collapsed by default — a wide table that isn't needed on most visits shouldn't sit open in the
    // way. Lives here (not inside renderQuestionMap) so it survives renderBoth tearing the map card
    // down and rebuilding it on every navigation, instead of silently re-collapsing on each click.
    let mapExpanded = false;
    // Re-renders both cards — the map's own rows/gaps change the moment a new node is created via the
    // tree editor's "add a swap invite" affordance, so it needs to stay in sync with every navigation,
    // not just the tree editor itself.
    const navigate = (path: EscalationPath) => {
      currentPath = path;
      renderBoth();
    };
    // The map sits above the tree editor — jumping from a map row/cell should bring the editor it just
    // navigated into view, unlike navigating from inside the (already-visible) editor itself.
    const navigateFromMap = (path: EscalationPath) => {
      navigate(path);
      treeCard.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const toggleMap = () => {
      mapExpanded = !mapExpanded;
      renderBoth();
    };
    const renderBoth = () => {
      mapCard.innerHTML = "";
      mapCard.appendChild(renderQuestionMap(config.questionRoot, navigateFromMap, mapExpanded, toggleMap));
      treeCard.innerHTML = "";
      treeCard.appendChild(renderNodeEditor(config.questionRoot, currentPath, navigate));
    };
    renderBoth();

    root.appendChild(renderTriggersSection(config));

    const sheetCard = document.createElement("div");
    root.appendChild(sheetCard);
    let pushStatus = "";
    let pullStatus = "";
    let pullPreview: { root: QuestionRoot; diff: DiffEntry[] } | null = null;
    const renderSheetCard = () => {
      sheetCard.innerHTML = "";
      sheetCard.appendChild(
        renderSheetSyncSection(pushStatus, pullStatus, pullPreview, {
          onPush: async () => {
            pushStatus = "Pushing…";
            renderSheetCard();
            try {
              await api.pushQuestionsToSheet();
              pushStatus = "Pushed.";
            } catch (err) {
              pushStatus = err instanceof Error ? err.message : "Push failed.";
            }
            renderSheetCard();
          },
          onPull: async () => {
            pullStatus = "Pulling…";
            pullPreview = null;
            renderSheetCard();
            try {
              const result = await api.pullQuestionsFromSheet();
              if ("errors" in result) {
                pullStatus = result.errors.join(" ");
              } else {
                pullStatus = "";
                pullPreview = { root: result.root, diff: diffQuestionRoots(config.questionRoot, result.root) };
              }
            } catch (err) {
              pullStatus = err instanceof Error ? err.message : "Pull failed.";
            }
            renderSheetCard();
          },
          onApply: () => {
            if (!pullPreview) return;
            config.questionRoot = pullPreview.root;
            pullPreview = null;
            pullStatus = "Applied — click Save all changes below to make it live.";
            currentPath = [];
            renderBoth();
            renderSheetCard();
          },
          onCancel: () => {
            pullPreview = null;
            pullStatus = "";
            renderSheetCard();
          },
        }),
      );
    };
    renderSheetCard();

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
 * A read-only overview of every question actually authored so far: one row per node (root included),
 * its own breadcrumb path and question preview, and a filled (✓) / empty (–) indicator for each of its
 * 10 possible child slots — the same fixed slot order the tree editor's two branch groups use. Purely
 * informational for now (per decision: no inline creation here yet, that may come later) — every
 * button just navigates the tree editor below to that path, reusing its existing create-on-demand
 * "Not yet configured" affordance rather than duplicating it. Collapsible (default collapsed) since a
 * wide table isn't needed on every visit — `expanded`/`onToggle` are owned by renderAdmin, not this
 * function, so the state survives this card being torn down and rebuilt on every navigation.
 */
function renderQuestionMap(root: QuestionRoot, navigate: (path: EscalationPath) => void, expanded: boolean, onToggle: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "accordion-toggle" + (expanded ? " expanded" : "");
  toggle.innerHTML = `<span>Question map</span><span class="chev">▾</span>`;
  toggle.addEventListener("click", onToggle);
  card.appendChild(toggle);

  if (!expanded) return card;

  const body = document.createElement("div");
  body.className = "accordion-body";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "Every question authored so far, and which of its own swap invites are filled in versus still open. Click a row's path to open it, or a slot directly to jump straight to that gap.";
  body.appendChild(note);

  const scroller = document.createElement("div");
  scroller.className = "map-scroll";
  const table = document.createElement("table");
  table.className = "map-table";

  const thead = document.createElement("thead");
  const groupRow = document.createElement("tr");
  groupRow.innerHTML = `<th rowspan="2">Path</th><th rowspan="2">Question</th><th colspan="5">Yes-path</th><th colspan="5">No-path</th>`;
  const labelRow = document.createElement("tr");
  const slotLabels = [...CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c]), "Mixed"];
  labelRow.innerHTML = [...slotLabels, ...slotLabels].map((label) => `<th>${label}</th>`).join("");
  thead.append(groupRow, labelRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of collectRows(root)) {
    const tr = document.createElement("tr");

    const pathCell = document.createElement("td");
    const pathBtn = document.createElement("button");
    pathBtn.type = "button";
    pathBtn.className = "map-link";
    pathBtn.textContent = row.label;
    pathBtn.addEventListener("click", () => navigate(row.path));
    pathCell.appendChild(pathBtn);
    tr.appendChild(pathCell);

    const qCell = document.createElement("td");
    qCell.className = "map-question";
    qCell.textContent = row.questionPreview || "(no question text yet)";
    tr.appendChild(qCell);

    const children = row.path.length === 0 ? root.children : resolveNode(root, row.path)!.children;
    for (const slot of SLOTS) {
      const cell = document.createElement("td");
      cell.className = "map-slot";
      const existing = childAt(children, slot);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-slot-btn" + (existing ? " filled" : " empty");
      btn.textContent = existing ? "✓" : "–";
      btn.title = existing ? existing.inviteQuestion : "Not yet configured";
      btn.addEventListener("click", () => {
        // Mirrors renderLeaf's own "add a swap invite" affordance — an empty slot has nothing to
        // navigate to yet, so create the blank node first, same as clicking it from inside the tree
        // editor itself would.
        if (!existing) setChildAt(children, slot, emptyNode());
        navigate([...row.path, slot]);
      });
      cell.appendChild(btn);
      tr.appendChild(cell);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroller.appendChild(table);
  body.appendChild(scroller);
  card.appendChild(body);

  return card;
}

/**
 * Every node in the escalation tree — root included — gets the identical editor shape: (non-root only)
 * a swap invite field, the same 4 timed question fields root has, its own shared yes/no follow-up, and
 * two branch groups of 5 leaves each (Friends/Colleagues/Family/Me/Mixed, once for the Yes-path and
 * once for the No-path). `navigate` re-renders this same card at a different path — see renderAdmin's
 * `renderBoth`.
 */
function renderNodeEditor(root: QuestionRoot, path: EscalationPath, navigate: (path: EscalationPath) => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const crumbs = document.createElement("div");
  crumbs.className = "breadcrumbs";
  crumbs.appendChild(breadcrumb("Routine question", path.length === 0, () => navigate([])));
  // Walks alongside the path, carrying each step's own parent yes/no (dynamicStepLabel needs the
  // PARENT's option text, not the step's own node) — root seeds it, each resolved step's own yes/no
  // becomes the parent for the next step.
  let parentYes = root.yes;
  let parentNo = root.no;
  for (let i = 0; i < path.length; i++) {
    const sep = document.createElement("span");
    sep.className = "breadcrumb-sep";
    sep.textContent = "/";
    crumbs.appendChild(sep);
    const target = path.slice(0, i + 1);
    crumbs.appendChild(breadcrumb(dynamicStepLabel(path[i], parentYes, parentNo), i === path.length - 1, () => navigate(target)));
    const stepNode = resolveNode(root, target);
    if (stepNode) {
      parentYes = stepNode.yes;
      parentNo = stepNode.no;
    }
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
  if (path.length === 0) {
    h.textContent = "Routine question";
  } else {
    // The label for THIS node's own step comes from its parent's yes/no — one level up from
    // parentYes/parentNo above, which by now hold this node's OWN yes/no after the breadcrumb loop.
    const grandparentPath = path.slice(0, -1);
    const grandparentNode = grandparentPath.length === 0 ? null : resolveNode(root, grandparentPath);
    const labelYes = grandparentNode ? grandparentNode.yes : root.yes;
    const labelNo = grandparentNode ? grandparentNode.no : root.no;
    h.textContent = `Swap invite: ${dynamicStepLabel(path[path.length - 1], labelYes, labelNo)}`;
  }
  card.appendChild(h);

  if (path.length > 0) {
    const inviteNote = document.createElement("p");
    inviteNote.className = "muted";
    inviteNote.textContent = "Asked once, as a yes/no confirmation, when the streak that unlocks this fires.";
    card.appendChild(inviteNote);
    card.appendChild(fieldLabel("Swap invite"));
    card.appendChild(textInput(node!.inviteQuestion, (v) => (node!.inviteQuestion = v)));

    card.appendChild(renderDigInSection(node!, path, navigate));
  }

  // Once a follow-up (digIn) picks among up to 4 options, THIS node's own timed questions are
  // superseded by whichever option ends up chosen — showing them here would just be dead inputs.
  const showBlockQuestions = path.length === 0 || !node!.digIn;
  if (showBlockQuestions) {
    const blockQuestionsNote = document.createElement("p");
    blockQuestionsNote.className = "muted";
    blockQuestionsNote.style.marginTop = "16px";
    blockQuestionsNote.textContent =
      path.length === 0
        ? "Each block's question is its own complete, independent sentence — write it exactly as it should read, since a user who's skipped the other three might see only this one on a given day."
        : "Once accepted, this becomes the routine question on every block going forward — its own complete, independent sentence per time of day, just like the routine question above.";
    card.appendChild(blockQuestionsNote);

    const blockQuestions = path.length === 0 ? root.blockQuestions : node!.blockQuestions;
    for (const [label, block] of ROOT_BLOCK_FIELDS) {
      card.appendChild(fieldLabel(`${label} question`));
      card.appendChild(textInput(blockQuestions[block], (v) => (blockQuestions[block] = v)));
    }
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
  card.appendChild(renderBranchGroup("Yes-path swap invites", "amplify", yes, children, path, navigate));
  card.appendChild(renderBranchGroup("No-path swap invites", "resolve", no, children, path, navigate));

  return card;
}

/**
 * Optional per node — most swap invites don't need this. When present, asks digIn.prompt once, right
 * after the invite is accepted, and waits for one of up to 4 admin-defined options before the override
 * actually takes effect (see DigIn's doc comment in api.ts). Options deliberately carry only a label +
 * their own 4 timed questions, not a full WHY follow-up of their own — keeping this manageable in
 * admin: ~20 fields per follow-up instead of ~50.
 */
function renderDigInSection(node: EscalationNode, path: EscalationPath, navigate: (path: EscalationPath) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "16px";

  if (!node.digIn) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "link-btn";
    addBtn.textContent = "Add a follow-up — let the user pick from up to 4 options before this takes effect";
    addBtn.addEventListener("click", () => {
      node.digIn = emptyDigIn();
      navigate(path);
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  const digIn = node.digIn;

  const groupLabel = document.createElement("p");
  groupLabel.className = "muted";
  groupLabel.style.fontWeight = "600";
  groupLabel.textContent = "Follow-up";
  wrap.appendChild(groupLabel);

  wrap.appendChild(fieldLabel("Prompt — asked once, right after accepting"));
  wrap.appendChild(textInput(digIn.prompt, (v) => (digIn.prompt = v)));

  digIn.options.forEach((option, index) => {
    const body = document.createElement("div");
    body.appendChild(fieldLabel("Label"));
    body.appendChild(textInput(option.label, (v) => (option.label = v), `Option ${index + 1}`));
    for (const [timedLabel, block] of ROOT_BLOCK_FIELDS) {
      body.appendChild(fieldLabel(`${timedLabel} question`));
      body.appendChild(textInput(option.blockQuestions[block], (v) => (option.blockQuestions[block] = v)));
    }
    wrap.appendChild(accordion(option.label || `Option ${index + 1}`, body));
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "link-btn";
  removeBtn.style.marginTop = "8px";
  removeBtn.textContent = "Remove follow-up";
  removeBtn.addEventListener("click", () => {
    node.digIn = undefined;
    navigate(path);
  });
  wrap.appendChild(removeBtn);

  return wrap;
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
  prompt: FollowupPrompt,
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

  // Each leaf's true label is this node's own configured option text for that category — the literal
  // button text a real user taps — falling back to CATEGORY_LABEL only while it's still blank.
  for (const cat of CATEGORY_ORDER) {
    wrap.appendChild(renderLeaf(prompt.options[cat] || CATEGORY_LABEL[cat], { valence, category: cat }, children, path, navigate));
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
    preview.textContent = existing.inviteQuestion || "(no question text yet)";
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
