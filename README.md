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

Seed question content into `CONFIG_KV` (see "Content" below):

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

For password reset emails, sign up at [resend.com](https://resend.com), get an API key, then:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FRONTEND_URL   # e.g. https://you.github.io/repo — used to build reset links
npx wrangler secret put EMAIL_FROM     # optional, defaults to Resend's shared "onboarding@resend.dev"
```

Without a verified domain in Resend, `onboarding@resend.dev` can only deliver to the email your Resend account itself is registered under — reset emails to anyone else's inbox won't arrive until you verify a domain there. Password reset for your own account works either way.

For "Sign in with Google": in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client ID (Web application). Add this exact Authorized redirect URI:

```
https://ping-backend.colebeing.workers.dev/api/auth/google/callback
```

Then:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Until both secrets are set, `/api/auth/google/start` returns 501 rather than breaking — verified. Google sign-in works the same as password signup: logging into an *existing* account (matched by email) or creating a *new* one both just work, no invite needed for either.

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

Question/follow-up wording is edited live in the Admin tab (`PUT /api/admin/config`) — that's the sole,
canonical place to edit it, not code. Each of the four daily blocks (q1-q4: morning/midday/afternoon/
evening) has its own complete, independently-written question — not composed from separate slots, so
each reads correctly on its own even for a user who's skipped the other three. WHY (the yes/no
follow-up prompt) is shared: editing it under q1 mirrors it into q2-q4 on save. WHAT and WHY follow-ups
**alternate** across successive same-valence answers for a block (one follow-up per answer, not both) —
this differs from the original spec text ("both firing on both yes and no"), changed deliberately to
keep answering lightweight.

`src/config.ts`'s `DEFAULT_CONFIG` is only a fallback for if `CONFIG_KV` is ever empty (e.g. a fresh
environment before the first seed); `npm run generate-seed-fallback` regenerates `scripts/config-seed.json`
from it, and `npm run seed` pushes that file to `CONFIG_KV`.

## Accounts and password reset

Signup is open — `POST /api/signup` just takes an email and password, no invite required; anyone who finds the app can create an account. Password reset (`POST /api/password-reset/request` → emails a 1-hour link → `POST /api/password-reset/confirm`) doesn't reveal whether an email has an account, by design.

## Admin

The Admin tab (shown only when `GET /api/me` reports `isAdmin: true` — set directly in KV, no self-service grant) edits question content, WHAT/WHY copy, escalation/streak thresholds, and saves live via `PUT /api/admin/config`, all writing `CONFIG_KV`'s `config` key. Thresholds and recommendation copy live in separate KV keys (`config:triggers`, `config:recommendation-copy`) so an Admin save of one section can never clobber another.

The "invitations to swap" section isn't just a phrasing tweak — when a streak trigger fires, the user is invited to swap their block's question for a full replacement, with its own yes/no follow-ups, just as fleshed out as the starter question. Each invitation is four complete questions (one per block, since it can fire on whichever block the streak happened on), not composed from shared slots. Up to 10 invitations are configurable: one per category (friends/colleagues/family/me) for a yes-streak ("amplify"), one per category for a no-streak ("resolve"), and one general yes-streak / general no-streak invitation for when the streak holds across mixed categories with no single one driving it (`backend/src/recommendations.ts`'s `detectStreaks`).

Admins also get an Analytics tab (`GET /api/admin/analytics`) showing usage across all users: total users/check-ins, active-user counts (7d/30d), a 30-day daily check-in chart, aggregate category and yes/no breakdowns, and a per-user table (join date, check-in count, last active, current daily streak, top category). Since `STATE_KV` has no query/scan beyond key listing, this handler lists every `user:*` key and reads each user's full state to aggregate — fine at current scale, but worth revisiting (e.g. a maintained user-index key) if the user count grows large enough to make that expensive.

## What's deliberately not built yet

Per the spec's "do not build until told go" and parked-idea sections: no calendar integration, no couples/B2B features, no custom category labels, no SAML (would only matter for a B2B direction the spec marks "tracked, not active"). Per-response need-quadrant tagging also isn't wired in — the spec explicitly parks that disambiguation logic; the backend still uses the coarser static `DOMAIN_NEED_MAP` in `src/types.ts`.

## Known gaps worth knowing about before relying on this

- No email verification on password-based signup — nothing confirms whoever signs up actually controls that inbox. Google sign-in doesn't have this gap — Google's own `email_verified` is checked.
- Password reset doesn't invalidate other existing sessions for the account — a stolen session token would survive a reset.
- Reset emails silently no-op if `RESEND_API_KEY` isn't set (reset always returns success either way, by design, to avoid leaking account existence — so a misconfigured key is easy to miss without checking Worker logs).
- No way to unsubscribe/remove a stale push subscription from a device you no longer use.
- The app icon (`frontend/public/icon.svg`) is a placeholder; add real branding + a PNG version for better iOS home-screen support before shipping.
- No onboarding flow — the spec calls for something minimal ("channel choice up front, calendar access earned later"); right now a new user just lands on login/signup.
- The end-user side of "invitations to swap" isn't in the frontend yet — `GET /api/recommendations` and `POST /api/recommendations/:id/accept` exist and are exercised by nothing but the admin content editor; there's no UI that shows a pending invitation to a user or lets them accept/decline it.
