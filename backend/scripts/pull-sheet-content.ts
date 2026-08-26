// Run with: npx tsx scripts/pull-sheet-content.ts
// Pulls the "Ping — Question Library" Google Sheet (must stay shared as
// "Anyone with the link — Viewer") and converts it into scripts/config-seed.json,
// in the same AppConfig shape src/config.ts's DEFAULT_CONFIG uses.
//
// Sheet columns: Path, When, How, Question, Earned By, Variant Type,
// Response 1-4 (Friends/Colleagues/Family/Me option text), R1-4 Tag (parked —
// per-response need-quadrant disambiguation isn't built, see spec), Status, Notes.
//
// WHY is the only follow-up now (WHAT was dropped) — expects one row per
// block valence: path "1y" and "1n". Only block 1 is drafted; block 2
// (evening) reuses the same WHY content with only the base question's WHEN
// slot swapped (start -> end).
import { writeFileSync } from "node:fs";

const SHEET_ID = "1i1l824brm4c23hj704_ItinbBXyDSauM_oQe0Tr-sVw";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

interface FollowupPrompt {
  prompt: string;
  options: { friends: string; colleagues: string; family: string; me: string };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function stripLeadingDid(s: string): string {
  return s.replace(/^Did\s+/i, "").trim();
}
function stripTrailingQuestionMark(s: string): string {
  return s.replace(/\?\s*$/, "").trim();
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(
      `Couldn't fetch the sheet (HTTP ${res.status}). Check it's still shared as "Anyone with the link — Viewer".`,
    );
  }
  const csv = await res.text();
  const rows = parseCsv(csv);
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const iPath = col("Path"),
    iWhen = col("When"),
    iHow = col("How"),
    iQuestion = col("Question"),
    iVariant = col("Variant Type"),
    iR1 = col("Response 1"),
    iR2 = col("Response 2"),
    iR3 = col("Response 3"),
    iR4 = col("Response 4");

  const byPath = new Map<string, string[]>();
  for (const r of rows.slice(1)) byPath.set(r[iPath], r);

  const base = byPath.get("1");
  if (!base) throw new Error('Missing base row with Path "1"');
  const whenBase = stripLeadingDid(base[iWhen]); // "today start/end"
  const how = stripTrailingQuestionMark(base[iHow]);

  function followup(path: string): FollowupPrompt {
    const r = byPath.get(path);
    if (!r) throw new Error(`Missing row with Path "${path}"`);
    return {
      prompt: r[iQuestion],
      options: { friends: r[iR1], colleagues: r[iR2], family: r[iR3], me: r[iR4] },
    };
  }

  // Sanity-check the variant-type labels match what we expect at each path.
  const expectVariant: Record<string, string> = { "1y": "Why", "1n": "Why" };
  for (const [path, expected] of Object.entries(expectVariant)) {
    const actual = byPath.get(path)?.[iVariant];
    if (actual !== expected) {
      console.warn(`Warning: expected Path ${path} Variant Type "${expected}", sheet has "${actual}"`);
    }
  }

  const sharedFollowups = {
    yes: followup("1y"),
    no: followup("1n"),
  };

  const config = {
    blocks: {
      "1": { question: { when: whenBase.replace("start/end", "start"), how }, ...sharedFollowups },
      "2": { question: { when: whenBase.replace("start/end", "end"), how }, ...sharedFollowups },
    },
  };

  writeFileSync(new URL("./config-seed.json", import.meta.url), JSON.stringify(config, null, 2) + "\n");
  console.log("Wrote scripts/config-seed.json from the Google Sheet");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
