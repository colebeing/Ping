// Run with: npm run generate-seed-fallback
// The Admin UI is the canonical place to edit live question content — this script only regenerates
// scripts/config-seed.json from src/config.ts's DEFAULT_CONFIG, e.g. to bootstrap a fresh KV namespace
// via `npm run seed`.
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/config";

writeFileSync(
  new URL("./config-seed.json", import.meta.url),
  JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
);
console.log("Wrote scripts/config-seed.json");
