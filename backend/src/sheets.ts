import {
  CATEGORIES,
  CATEGORY_LABEL,
  type Category,
  type DigIn,
  type DigInOption,
  type EscalationChildren,
  type EscalationNode,
  type EscalationPath,
  type EscalationStep,
  type Env,
  type FollowupPrompt,
  type LiveBlockId,
  type QuestionRoot,
} from "./types";
import { getGoogleAccessToken, parseServiceAccount } from "./google-service-account";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const QUESTIONS_SHEET = "Questions";
const OPTIONS_SHEET = "Follow-up options";

const QUESTIONS_HEADER = [
  "Path (do not edit)",
  "Path ID",
  "Breadcrumb",
  "Label",
  "Invite question",
  "Morning",
  "Midday",
  "Afternoon",
  "Evening",
  "Yes prompt",
  ...CATEGORIES.map((c) => `Yes: ${CATEGORY_LABEL[c]}`),
  "No prompt",
  ...CATEGORIES.map((c) => `No: ${CATEGORY_LABEL[c]}`),
  "Follow-up prompt",
];
const OPTIONS_HEADER = ["Path (do not edit)", "Path ID", "Option #", "Label", "Morning", "Midday", "Afternoon", "Evening"];

/** The 10 possible child slots off any node, in a fixed order — mirrors frontend/src/views/admin.ts's
 * own SLOTS constant (kept as a separate copy since this file has no shared import path to it). */
const SLOTS: EscalationStep[] = [
  ...CATEGORIES.map((category) => ({ valence: "yes" as const, category })),
  { valence: "yes" as const, category: null },
  ...CATEGORIES.map((category) => ({ valence: "no" as const, category })),
  { valence: "no" as const, category: null },
];

function childAt(children: EscalationChildren, step: EscalationStep): EscalationNode | undefined {
  return step.category === null ? (step.valence === "yes" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
}

function setChildAt(children: EscalationChildren, step: EscalationStep, node: EscalationNode): void {
  if (step.category === null) {
    if (step.valence === "yes") children.generalYes = node;
    else children.generalNo = node;
  } else {
    children[step.valence][step.category] = node;
  }
}

function stepLabel(step: EscalationStep): string {
  if (step.category === null) return step.valence === "yes" ? "Mixed (yes-streak)" : "Mixed (no-streak)";
  return `${step.valence === "yes" ? "Yes" : "No"}: ${CATEGORY_LABEL[step.category]}`;
}

function pathKey(path: EscalationPath): string {
  return JSON.stringify(path);
}

/** Compact human-readable node reference — a shorter alternative to the raw JSON `Path (do not edit)`
 * column, distinct from `Breadcrumb`'s admin-navigation arrows (see stepLabel/walk below). Root is
 * "1"; each step appends the valence taken ("y"/"n") then a category letter — E/P/I/C for a specific
 * category (first letter of Category, already unique), or Y/N for the mixed/general slot, matching
 * its own valence (Y pairs with yes, N with no). Every level beyond the first wraps everything
 * before it in parens before appending its own 2 characters (e.g. "1yE", then "(1yE)nN", then
 * "((1yE)nN)yP") — purely a readability aid marking each row boundary in a long chain, not needed to
 * parse it: every level is a fixed 2 characters, so it's already unambiguous without them.
 *
 * Deliberately carries no dig-in resolution digit: a node's row manages all of its own questions
 * (invite/yes/no/dig-in prompt) together regardless of dig-in, and — as of this writing — dig-in
 * choice never affects which children exist (EscalationNode.children is one shared field, not
 * per-option), so a resolution digit here would currently just be noise. If that ever changes (children
 * becoming dig-in-dependent), every existing id is safe to retrofit by mechanically appending "0" —
 * today's dig-in-agnostic children are already equivalent to "always resolution 0", so there's nothing
 * to migrate until the feature exists. See optionsRowValues below for where a dig-in choice does get
 * its own address today (this same id plus the option number). */
function pathId(path: EscalationPath): string {
  let id = "1";
  path.forEach((step, i) => {
    const step2 = (step.valence === "yes" ? "y" : "n") + (step.category === null ? (step.valence === "yes" ? "Y" : "N") : step.category[0].toUpperCase());
    id = i === 0 ? id + step2 : `(${id})${step2}`;
  });
  return id;
}

// ---------- flatten (push) ----------

function questionsRowValues(
  path: EscalationPath,
  id: string,
  breadcrumb: string,
  label: string,
  inviteQuestion: string,
  blockQuestions: Record<LiveBlockId, string>,
  yes: FollowupPrompt,
  no: FollowupPrompt,
  digInPrompt: string,
): string[] {
  return [
    pathKey(path),
    id,
    breadcrumb,
    label,
    inviteQuestion,
    blockQuestions.q1,
    blockQuestions.q2,
    blockQuestions.q3,
    blockQuestions.q4,
    yes.prompt,
    ...CATEGORIES.map((c) => yes.options[c]),
    no.prompt,
    ...CATEGORIES.map((c) => no.options[c]),
    digInPrompt,
  ];
}

function optionsRowValues(path: EscalationPath, id: string, optionNumber: number, option: DigInOption): string[] {
  return [pathKey(path), `${id}${optionNumber}`, String(optionNumber), option.label, option.blockQuestions.q1, option.blockQuestions.q2, option.blockQuestions.q3, option.blockQuestions.q4];
}

/** Walks the whole tree into two flat row sets — one per node (root included), one per non-blank
 * dig-in option — same depth-first walk frontend/src/views/admin.ts's collectRows already uses for
 * the Question Map, just producing full rows instead of a preview. */
export function flattenTree(root: QuestionRoot): { questions: string[][]; options: string[][] } {
  const questions: string[][] = [questionsRowValues([], pathId([]), "Routine question", root.label ?? "", "", root.blockQuestions, root.yes, root.no, "")];
  const options: string[][] = [];

  const walk = (children: EscalationChildren, path: EscalationPath, breadcrumbPrefix: string) => {
    for (const step of SLOTS) {
      const child = childAt(children, step);
      if (!child) continue;
      const childPath = [...path, step];
      const id = pathId(childPath);
      const breadcrumb = `${breadcrumbPrefix} → ${stepLabel(step)}`;
      questions.push(questionsRowValues(childPath, id, breadcrumb, child.label ?? "", child.inviteQuestion, child.blockQuestions, child.yes, child.no, child.digIn?.prompt ?? ""));
      if (child.digIn) {
        child.digIn.options.forEach((option, i) => {
          if (!option.label) return;
          options.push(optionsRowValues(childPath, id, i + 1, option));
        });
      }
      walk(child.children, childPath, breadcrumb);
    }
  };
  walk(root.children, [], "Routine question");
  return { questions, options };
}

// ---------- reconstruct (pull) ----------

/** The inverse of questionsRowValues' `...CATEGORIES.map((c) => X.options[c])` spread — reads that
 * same run of columns back into a Record<Category, string>, in CATEGORIES' order starting at `startCol`. */
function optionsFromColumns(row: string[], startCol: number): Record<Category, string> {
  return Object.fromEntries(CATEGORIES.map((c, i) => [c, row[startCol + i] ?? ""])) as Record<Category, string>;
}

function parsePath(raw: string | undefined): EscalationPath | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const path: EscalationPath = [];
  for (const step of parsed) {
    if (typeof step !== "object" || step === null) return null;
    const { valence: rawValence, category } = step as { valence?: unknown; category?: unknown };
    // Accepts a real spreadsheet's already-pushed "amplify"/"resolve" JSON from before that rename to
    // "yes"/"no", same lazy-on-read tolerance as every other rename in this codebase — a pull must not
    // break just because a push under the old scheme already wrote real cells.
    const valence = rawValence === "amplify" ? "yes" : rawValence === "resolve" ? "no" : rawValence;
    if (valence !== "yes" && valence !== "no") return null;
    if (category !== null && !CATEGORIES.includes(category as Category)) return null;
    path.push({ valence, category: category as Category | null });
  }
  return path;
}

interface ParsedQuestionRow {
  path: EscalationPath;
  key: string;
  label: string;
  inviteQuestion: string;
  blockQuestions: Record<LiveBlockId, string>;
  yes: FollowupPrompt;
  no: FollowupPrompt;
  digInPrompt: string;
}

interface ParsedOptionRow {
  key: string;
  optionNumber: number;
  label: string;
  blockQuestions: Record<LiveBlockId, string>;
}

export type PullResult = { ok: true; root: QuestionRoot } | { ok: false; errors: string[] };

/** Reconstructs the tree from the two sheet tabs — validates everything before building anything
 * (root row present exactly once, every path parses, no duplicate paths, every non-root row's parent
 * has its own row, every Follow-up options row matches a Questions row with a non-blank Follow-up
 * prompt, option # is 1-4) and returns a specific error list rather than a best-effort guess. */
export function reconstructTree(questionsValues: string[][], optionsValues: string[][]): PullResult {
  const errors: string[] = [];

  const questionRows: ParsedQuestionRow[] = [];
  const seenKeys = new Set<string>();
  for (let i = 1; i < questionsValues.length; i++) {
    const row = questionsValues[i];
    const rowNum = i + 1;
    if (!row || !row[0]) continue; // blank trailing row
    const path = parsePath(row[0]);
    if (!path) {
      errors.push(`Questions row ${rowNum}: path isn't valid`);
      continue;
    }
    const key = pathKey(path);
    if (seenKeys.has(key)) {
      errors.push(`Questions row ${rowNum}: duplicate path ${key}`);
      continue;
    }
    seenKeys.add(key);
    // Columns 1-2 (Path ID, Breadcrumb) are skipped here deliberately — display-only renderings of
    // `path` (see pathId/stepLabel), never read back on pull. Label (3) IS read back — unlike those
    // two, it's admin-editable content, not derived from the path.
    questionRows.push({
      path,
      key,
      label: row[3] ?? "",
      inviteQuestion: row[4] ?? "",
      blockQuestions: { q1: row[5] ?? "", q2: row[6] ?? "", q3: row[7] ?? "", q4: row[8] ?? "" },
      yes: { prompt: row[9] ?? "", options: optionsFromColumns(row, 10) },
      no: { prompt: row[14] ?? "", options: optionsFromColumns(row, 15) },
      digInPrompt: row[19] ?? "",
    });
  }

  const rootRows = questionRows.filter((r) => r.path.length === 0);
  if (rootRows.length === 0) errors.push('Questions sheet is missing the root row (path "[]")');
  if (rootRows.length > 1) errors.push("Questions sheet has more than one root row");

  const byKey = new Map(questionRows.map((r) => [r.key, r]));
  for (const r of questionRows) {
    if (r.path.length === 0) continue;
    const parentKey = pathKey(r.path.slice(0, -1));
    if (!byKey.has(parentKey)) errors.push(`Questions row for path ${r.key}: its parent (${parentKey}) has no row of its own`);
  }

  const optionRows: ParsedOptionRow[] = [];
  const optionsByKey = new Map<string, ParsedOptionRow[]>();
  for (let i = 1; i < optionsValues.length; i++) {
    const row = optionsValues[i];
    const rowNum = i + 1;
    if (!row || !row[0]) continue;
    const path = parsePath(row[0]);
    if (!path) {
      errors.push(`Follow-up options row ${rowNum}: path isn't valid`);
      continue;
    }
    const key = pathKey(path);
    if (!byKey.has(key)) {
      errors.push(`Follow-up options row ${rowNum}: path ${key} has no matching Questions row`);
      continue;
    }
    // Column 1 (Path ID) is skipped here deliberately — display-only, derived from `path` + option #.
    const optionNumber = Number(row[2]);
    if (!Number.isInteger(optionNumber) || optionNumber < 1 || optionNumber > 4) {
      errors.push(`Follow-up options row ${rowNum}: option # must be 1-4`);
      continue;
    }
    const parsedRow: ParsedOptionRow = { key, optionNumber, label: row[3] ?? "", blockQuestions: { q1: row[4] ?? "", q2: row[5] ?? "", q3: row[6] ?? "", q4: row[7] ?? "" } };
    optionRows.push(parsedRow);
    const arr = optionsByKey.get(key) ?? [];
    arr.push(parsedRow);
    optionsByKey.set(key, arr);
  }
  for (const key of optionsByKey.keys()) {
    const row = byKey.get(key);
    if (row && !row.digInPrompt) errors.push(`Follow-up options exist for path ${key} but its Follow-up prompt is blank`);
  }

  if (errors.length > 0) return { ok: false, errors };

  function buildDigIn(row: ParsedQuestionRow): DigIn | undefined {
    if (!row.digInPrompt) return undefined;
    const blank = (): DigInOption => ({ label: "", blockQuestions: { q1: "", q2: "", q3: "", q4: "" } });
    const slots: [DigInOption, DigInOption, DigInOption, DigInOption] = [blank(), blank(), blank(), blank()];
    for (const o of optionsByKey.get(row.key) ?? []) slots[o.optionNumber - 1] = { label: o.label, blockQuestions: o.blockQuestions };
    return { prompt: row.digInPrompt, options: slots };
  }

  function buildChildren(parentPath: EscalationPath): EscalationChildren {
    const children: EscalationChildren = { yes: {}, no: {} };
    for (const step of SLOTS) {
      const row = byKey.get(pathKey([...parentPath, step]));
      if (!row) continue;
      setChildAt(children, step, {
        label: row.label || undefined,
        inviteQuestion: row.inviteQuestion,
        blockQuestions: row.blockQuestions,
        yes: row.yes,
        no: row.no,
        digIn: buildDigIn(row),
        children: buildChildren(row.path),
      });
    }
    return children;
  }

  const rootRow = rootRows[0];
  const root: QuestionRoot = {
    label: rootRow.label || undefined,
    blockQuestions: rootRow.blockQuestions,
    yes: rootRow.yes,
    no: rootRow.no,
    children: buildChildren([]),
  };
  return { ok: true, root };
}

// ---------- Sheets API ----------

interface SheetsClient {
  spreadsheetId: string;
  accessToken: string;
}

async function sheetsClient(env: Env): Promise<SheetsClient | { error: string }> {
  if (!env.SHEETS_SPREADSHEET_ID) return { error: "SHEETS_SPREADSHEET_ID isn't configured on the server" };
  const account = parseServiceAccount(env);
  if (!account) return { error: "Google service account isn't configured on the server" };
  const accessToken = await getGoogleAccessToken(account, SHEETS_SCOPE);
  return { spreadsheetId: env.SHEETS_SPREADSHEET_ID, accessToken };
}

async function ensureTabsExist(client: SheetsClient): Promise<void> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${client.spreadsheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${client.accessToken}` },
  });
  if (!res.ok) throw new Error(`Sheets metadata fetch failed: ${res.status} ${await res.text()}`);
  const data: { sheets?: { properties: { title: string } }[] } = await res.json();
  const existing = new Set((data.sheets ?? []).map((s) => s.properties.title));
  const missing = [QUESTIONS_SHEET, OPTIONS_SHEET].filter((title) => !existing.has(title));
  if (missing.length === 0) return;

  const res2 = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${client.spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${client.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
  });
  if (!res2.ok) throw new Error(`Sheets addSheet failed: ${res2.status} ${await res2.text()}`);
}

async function writeTab(client: SheetsClient, title: string, header: string[], rows: string[][]): Promise<void> {
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${client.spreadsheetId}/values/${encodeURIComponent(title)}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${client.accessToken}` },
  });
  if (!clearRes.ok) throw new Error(`Sheets clear (${title}) failed: ${clearRes.status} ${await clearRes.text()}`);

  const range = `${encodeURIComponent(title)}!A1`;
  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${client.spreadsheetId}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${client.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [header, ...rows] }),
  });
  if (!updateRes.ok) throw new Error(`Sheets write (${title}) failed: ${updateRes.status} ${await updateRes.text()}`);
}

async function readTab(client: SheetsClient, title: string): Promise<string[][]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${client.spreadsheetId}/values/${encodeURIComponent(title)}`, {
    headers: { Authorization: `Bearer ${client.accessToken}` },
  });
  if (!res.ok) throw new Error(`Sheets read (${title}) failed: ${res.status} ${await res.text()}`);
  const data: { values?: string[][] } = await res.json();
  return data.values ?? [];
}

/** Full replace, always — KV is always the source of truth for what gets written here, so there's
 * nothing to diff on this direction (unlike pull, which is reviewed before it touches anything live). */
export async function pushTreeToSheet(env: Env, root: QuestionRoot): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = await sheetsClient(env);
  if ("error" in client) return { ok: false, error: client.error };
  try {
    await ensureTabsExist(client);
    const { questions, options } = flattenTree(root);
    await writeTab(client, QUESTIONS_SHEET, QUESTIONS_HEADER, questions);
    await writeTab(client, OPTIONS_SHEET, OPTIONS_HEADER, options);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Push to Sheet failed" };
  }
}

export async function pullTreeFromSheet(env: Env): Promise<PullResult> {
  const client = await sheetsClient(env);
  if ("error" in client) return { ok: false, errors: [client.error] };
  try {
    const [questionsValues, optionsValues] = await Promise.all([readTab(client, QUESTIONS_SHEET), readTab(client, OPTIONS_SHEET)]);
    return reconstructTree(questionsValues, optionsValues);
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : "Pull from Sheet failed"] };
  }
}
