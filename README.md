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

Seed the default (placeholder) question content into `CONFIG_KV`:

```bash
npm run seed
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

## What's deliberately not built yet

Per the spec's "do not build until told go" and parked-idea sections: no admin UI for editing questions/content (edit `backend/scripts/config-seed.json` and re-run `npm run seed` instead), no calendar integration, no couples/B2B features, no custom category labels.

## Known gaps worth knowing about before relying on this

- No password reset / email verification flow.
- No way to unsubscribe/remove a stale push subscription from a device you no longer use.
- Streak length (3 days) and retirement window (7 days) are tunable constants in `backend/src/recommendations.ts` — the spec doesn't pin exact numbers, these are reasonable defaults.
- The app icon (`frontend/public/icon.svg`) is a placeholder; add real branding + a PNG version for better iOS home-screen support before shipping.
- Question/follow-up wording in `backend/scripts/config-seed.json` is placeholder copy pending the real content doc referenced in the spec.
