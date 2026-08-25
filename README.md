# Ping

Development for Ping, the question engine that powers a more intentional life.

Phone-first PWA nightly-check app, per `nightly-check-spec.md`. Two independent projects:

- `backend/` — Cloudflare Worker (API + KV storage + a Durable Object per user for push scheduling)
- `frontend/` — static PWA (Vite), deployed to GitHub Pages

**Live:**
- Backend: `https://ping-backend.colebeing.workers.dev`
- Frontend: `https://colebeing.github.io/Ping/`
- Pushing to `main` auto-redeploys the frontend via `.github/workflows/deploy-frontend.yml`. The backend does not auto-deploy — run `npm run deploy` in `backend/` by hand after backend changes.

## Backend setup (already done for the live deployment above — for reference / a fresh environment)

```bash
cd backend
npm install
npx wrangler login
npx wrangler kv namespace create CONFIG_KV
npx wrangler kv namespace create STATE_KV
```

Paste the two namespace ids into `wrangler.toml`.

Seed question content into `CONFIG_KV` from the content sheet (see "Content" below):

```bash
npm run seed-from-sheet
```

Generate VAPID keys for push (needs the `web-push` CLI, or any VAPID generator):

```bash
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT   # e.g. mailto:you@example.com
npx wrangler secret put ALLOWED_ORIGINS # your GitHub Pages URL, e.g. https://you.github.io
```

`ALLOWED_ORIGINS` can be a comma-separated list. If unset, the API reflects any origin — fine for local dev, not for production.

Run locally: `npm run dev`. Deploy: `npm run deploy`.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local   # set VITE_API_BASE to your deployed Worker URL
npm run dev
```

`npm run build` outputs `dist/`, which the GitHub Actions workflow publishes to GitHub Pages automatically on push to `main`. GitHub Pages requires a public repo on the free plan (nothing sensitive is committed — secrets live in Cloudflare's secret store, not in this repo).

## Push notification scheduling

Each user gets one Durable Object (`PushScheduler`, keyed by their email), which sets a single alarm for their soonest upcoming check-in time and re-sends itself after firing. This exists instead of a Cloudflare Cron Trigger: a cron trigger was tried first (per the original spec's "hourly cron" plan) and confirmed correctly registered via both the dashboard and the Cloudflare API, but it never actually executed across three tested schedules (every minute, every 5 minutes, offset every 5 minutes) — a platform-side issue on this account, not a config bug. Durable Object alarms sidestep that entirely and, as a bonus, give exact-minute cadence precision rather than being bucketed to whatever the cron interval is.

A user's alarm is (re)computed whenever they update their cadence (`POST /api/cadence`) or add a push subscription (`POST /api/push/subscribe`) — see `scheduleUserPush` in `backend/src/scheduler.ts`.

## Content

Question/follow-up wording lives in the ["Ping — Question Library"](https://docs.google.com/spreadsheets/d/1i1l824brm4c23hj704_ItinbBXyDSauM_oQe0Tr-sVw/edit) Google Sheet, not in code. To publish an edit:

```bash
npm run seed-from-sheet
```

This pulls the sheet's public CSV export (`backend/scripts/pull-sheet-content.ts`), converts it to `config-seed.json`, and writes it to `CONFIG_KV` — no redeploy needed, live within seconds. The sheet must stay shared as "Anyone with the link — Viewer" for the pull to work unauthenticated; if you lock it down, `pull-sheet-content.ts` will fail with a clear error rather than silently using stale data.

Only block 1 (morning) content is drafted; block 2 reuses it verbatim (only the base question's WHEN slot swaps start→end) — see `pull-sheet-content.ts` if that should change. WHAT and WHY follow-ups **alternate** across successive same-valence answers for a block (one follow-up per answer, not both) — this differs from the original spec text ("both firing on both yes and no"), changed deliberately to keep answering lightweight.

`src/config.ts`'s `DEFAULT_CONFIG` is only a fallback for if `CONFIG_KV` is ever empty (e.g. a fresh environment before the first seed) — it's hardcoded to match the sheet's current content but won't stay in sync automatically; the sheet is the source of truth.

## What's deliberately not built yet

Per the spec's "do not build until told go" and parked-idea sections: no admin UI for editing questions/content (the sheet + `npm run seed-from-sheet` fills that role informally), no calendar integration, no couples/B2B features, no custom category labels. Per-response need-quadrant tagging (the sheet's R1-4 Tag columns) also isn't wired in — the spec explicitly parks that disambiguation logic; the backend still uses the coarser static `DOMAIN_NEED_MAP` in `src/types.ts`.

## Known gaps worth knowing about before relying on this

- No password reset / email verification flow.
- No way to unsubscribe/remove a stale push subscription from a device you no longer use.
- Streak length (3 days) and retirement window (7 days) are tunable constants in `backend/src/recommendations.ts` — the spec doesn't pin exact numbers, these are reasonable defaults.
- The app icon (`frontend/public/icon.svg`) is a placeholder; add real branding + a PNG version for better iOS home-screen support before shipping.
- Only block 1's content is drafted in the sheet; block 2 is a verbatim reuse, not independently written.
