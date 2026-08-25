// Run with: npx tsx scripts/generate-config-seed.ts
// Writes DEFAULT_CONFIG to scripts/config-seed.json, which `npm run seed`
// then puts into CONFIG_KV via wrangler. Re-run after editing src/config.ts
// defaults; edit config-seed.json directly for day-to-day content tweaks
// (no code change / redeploy needed for that — just re-run `npm run seed`).
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/config";

writeFileSync(
  new URL("./config-seed.json", import.meta.url),
  JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
);
console.log("Wrote scripts/config-seed.json");
