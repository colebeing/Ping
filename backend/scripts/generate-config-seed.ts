// Run with: npm run generate-seed-fallback
// The Admin UI is the canonical place to edit live question content — this script only regenerates
// scripts/config-seed.json + scripts/question-root-seed.json from src/config.ts's DEFAULT_CONFIG/
// DEFAULT_QUESTION_ROOT, e.g. to bootstrap a fresh KV namespace via `npm run seed`. Two separate files
// because they're two separate KV keys ("config" vs "config:question-root"), kept apart so a content
// re-seed of one can never clobber the other.
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG, DEFAULT_QUESTION_ROOT } from "../src/config";

writeFileSync(
  new URL("./config-seed.json", import.meta.url),
  JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
);
writeFileSync(
  new URL("./question-root-seed.json", import.meta.url),
  JSON.stringify(DEFAULT_QUESTION_ROOT, null, 2) + "\n",
);
console.log("Wrote scripts/config-seed.json and scripts/question-root-seed.json");
