// Run with: npm run generate-seed-fallback
// Content lives in the "Ping — Question Library" Google Sheet now — use
// `npm run seed-from-sheet` for normal content updates instead. This script
// is only for regenerating scripts/config-seed.json from src/config.ts's
// hardcoded DEFAULT_CONFIG, e.g. if you need to bootstrap without the sheet.
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/config";

writeFileSync(
  new URL("./config-seed.json", import.meta.url),
  JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
);
console.log("Wrote scripts/config-seed.json");
