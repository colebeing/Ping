# Ping

Development for Ping, the question engine that powers a more intentional life.

Phone-first PWA nightly-check app, per `nightly-check-spec.md`. Two independent projects:

- `backend/` — Cloudflare Worker (API + KV storage + hourly push cron)
- `frontend/` — static PWA (Vite), deployable to GitHub Pages

Backend is live at `https://ping-backend.colebeing.workers.dev`, KV namespaces created and seeded, VAPID push secrets set. Frontend hasn't been deployed yet.

## Backend setup

```bash
cd backend
npm install
npx wrangler login
npx wrangler kv namespace create CONFIG_KV
npx wrangler kv namespace create STATE_KV
```

Paste the two namespace ids into `wrangler.toml` (`REPLACE_WITH_CONFIG_KV_ID` / `REPLACE_WITH_STATE_KV_ID`).

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

Run locally:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local   # set VITE_API_BASE to your deployed Worker URL
npm run dev
```

Build for GitHub Pages:

```bash
npm run build
```

This outputs `dist/`. Publish it to a `gh-pages` branch (or via a GitHub Actions workflow) of whatever repo you host this in.

## What's deliberately not built yet

Per the spec's "do not build until told go" and parked-idea sections: no admin UI for editing questions/content (edit `backend/scripts/config-seed.json` and re-run `npm run seed` instead), no calendar integration, no couples/B2B features, no custom category labels.

## Known gaps worth knowing about before relying on this

- No password reset / email verification flow.
- The `@block65/webcrypto-web-push` API (used in `backend/src/push.ts`) was integrated from documentation, not a live install/typecheck — verify `buildPushPayload`'s exact signature against the installed package version once `npm install` runs, since this environment has no Node.js to confirm it compiles.
- Streak length (3 days) and retirement window (7 days) are tunable constants in `backend/src/recommendations.ts` — the spec doesn't pin exact numbers, these are reasonable defaults.
- The app icon (`frontend/public/icon.svg`) is a placeholder; add real branding + a PNG version for better iOS home-screen support before shipping.
