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

For password reset and invite emails, sign up at [resend.com](https://resend.com), get an API key, then:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FRONTEND_URL   # e.g. https://you.github.io/repo — used to build reset/invite links
npx wrangler secret put EMAIL_FROM     # optional, defaults to Resend's shared "onboarding@resend.dev"
```

Without a verified domain in Resend, `onboarding@resend.dev` can only deliver to the email your Resend account itself is registered under — invites to anyone else's inbox won't arrive until you verify a domain there. Password reset for your own account works either way.

For "Sign in with Google": in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client ID (Web application). Add this exact Authorized redirect URI:

```
https://ping-backend.colebeing.workers.dev/api/auth/google/callback
```

Then:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Until both secrets are set, `/api/auth/google/start` returns 501 rather than breaking — verified. Google sign-in follows the same invite rule as password signup: logging into an *existing* account (matched by email) always works, creating a *new* one still needs a valid invite token.

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

## Accounts, invites, and password reset

Signup requires a valid invite (`POST /api/signup` takes an `inviteToken`) — there's no open signup. Any logged-in user can invite someone via Settings → Invite someone (`POST /api/invite`), which emails a signup link good for 7 days, single-use. Password reset (`POST /api/password-reset/request` → emails a 1-hour link → `POST /api/password-reset/confirm`) doesn't reveal whether an email has an account, by design.

## Admin

The Admin tab (shown only when `GET /api/me` reports `isAdmin: true` — set directly in KV, no self-service grant) edits question content, WHAT/WHY copy, escalation/streak thresholds, and saved live via `PUT /api/admin/config`. Question content there and the Google Sheet write the same underlying data (`CONFIG_KV`'s `config` key) — whichever you touch last wins. Thresholds and recommendation copy live in separate KV keys (`config:triggers`, `config:recommendation-copy`) specifically so the sheet pull can never overwrite them.

The "invitations to swap" section isn't just a phrasing tweak — when a streak trigger fires, the user is invited to swap their block's HOW question for a full replacement, with its own yes/no follow-ups, just as fleshed out as the starter question. Up to 10 invitations are configurable: one per category (friends/colleagues/family/me) for a yes-streak ("amplify"), one per category for a no-streak ("resolve"), and one general yes-streak / general no-streak invitation for when the streak holds across mixed categories with no single one driving it (`backend/src/recommendations.ts`'s `detectStreaks`).

Admins also get an Analytics tab (`GET /api/admin/analytics`) showing usage across all users: total users/check-ins, active-user counts (7d/30d), a 30-day daily check-in chart, aggregate category and yes/no breakdowns, and a per-user table (join date, check-in count, last active, current daily streak, top category). Since `STATE_KV` has no query/scan beyond key listing, this handler lists every `user:*` key and reads each user's full state to aggregate — fine at current scale, but worth revisiting (e.g. a maintained user-index key) if the user count grows large enough to make that expensive.

## What's deliberately not built yet

Per the spec's "do not build until told go" and parked-idea sections: no calendar integration, no couples/B2B features, no custom category labels, no SAML (would only matter for a B2B direction the spec marks "tracked, not active"). Per-response need-quadrant tagging (the sheet's R1-4 Tag columns) also isn't wired in — the spec explicitly parks that disambiguation logic; the backend still uses the coarser static `DOMAIN_NEED_MAP` in `src/types.ts`.

## Known gaps worth knowing about before relying on this

- No email verification on password-based signup (an invite implicitly vouches for the email, but nothing confirms the invitee actually controls that inbox). Google sign-in doesn't have this gap — Google's own `email_verified` is checked.
- Password reset doesn't invalidate other existing sessions for the account — a stolen session token would survive a reset.
- Invite/reset emails silently no-op if `RESEND_API_KEY` isn't set (reset always returns success either way, by design, to avoid leaking account existence — so a misconfigured key is easy to miss without checking Worker logs).
- No way to unsubscribe/remove a stale push subscription from a device you no longer use.
- The app icon (`frontend/public/icon.svg`) is a placeholder; add real branding + a PNG version for better iOS home-screen support before shipping.
- Only block 1's content is drafted in the sheet; block 2 is a verbatim reuse, not independently written.
- No onboarding flow — the spec calls for something minimal ("channel choice up front, calendar access earned later"); right now a new user just lands on login/signup.
- The end-user side of "invitations to swap" isn't in the frontend yet — `GET /api/recommendations` and `POST /api/recommendations/:id/accept` exist and are exercised by nothing but the admin content editor; there's no UI that shows a pending invitation to a user or lets them accept/decline it.
