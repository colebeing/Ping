# Ping — Product Principles

A living list of the rules Ping's design should bend to. These aren't feature specs — they're the filter for deciding between two otherwise-reasonable ways to build something. When a feature choice is ambiguous, come back here before improvising.

Each entry: the principle, why it matters, where the current app already lives up to it, and where it currently doesn't (so the gap is visible instead of quietly forgotten).

---

## 1. Hyperlightweight

**Every interaction needs to be as easy as thinking.** No typing, never more than four taps per interaction. Get users OUT of the app — the app's job is to interrupt for three seconds, not to be a destination.

**Why:** the moment a check-in feels like "opening an app," it starts competing with everything else that also wants that attention. A habit-tracking tool that costs more than a reflex will get skipped exactly on the days that matter most (busy, tired, distracted).

**Where it holds today:**
- A "No" answer costs **zero app-opens** — it resolves straight from the push notification action (commit `f1a52eda`, "one notification, one action: body tap = yes, action = no").
- A "Yes" answer costs exactly **2 taps** once you're in the app: Yes → pick a category ([blockCard.ts](frontend/src/blockCard.ts)). Notification-tap + 2 = 3 taps worst case, under the 4-tap ceiling.
- No typing anywhere in the daily flow — every input is a tap on a preset option.
- Onboarding itself is now zero taps: no email, no password, not even a screen to read past — a first-ever visit silently mints an anonymous account and lands straight on Home ([main.ts](frontend/src/main.ts)'s `boot()`, `api.startAnonymous()`). Notification permission is asked for from Home itself, not as a gate in front of it. An email/Google account moved from "required before you can start" to "optional, added later from Settings."

**Where it's in tension:**
- The category follow-up ([blockCard.ts:90-100](frontend/src/blockCard.ts:90)) is a full app-open just to tap one of four buttons. It's within budget today, but it's the one screen standing between "answered" and "back to whatever you were doing." If the "get users out of the app" half of this principle is meant literally, that pick should eventually collapse into notification quick-actions too (e.g. category-specific actions instead of a generic "Yes").
- Undecided: is 4 taps a hard ceiling worth blocking a feature over, or a guideline to flag and discuss when a feature would exceed it?

---

## 2. Hyperavailable

**Literally anyone should eventually be able to use this service with little effort.** Low floor to get in, low effort to keep using it, regardless of who they are or what they already have.

**Why:** Ping exists to help people exist better — that's a basic function, not a premium one, so it has to be free and available to everyone. Paid tiers for specific use cases may come later, but the core service is not allowed to gatekeep on ability to pay.

**Where it holds today:**
- Auth doesn't require Google — email + password works standalone ([auth.ts](backend/src/routes/auth.ts)), with Google OAuth as an alternative, not a requirement. No account is locked out for lacking a specific vendor login.
- The daily interaction itself (Yes/No + tap a category) has no literacy or tech-savviness bar beyond "can tap a button."
- Signup shipped fully open (the earlier invite-only gate was removed) — and now goes further than "open," to "not required at all": anyone can use the whole core loop with no account of any kind ([auth.ts](backend/src/auth.ts)'s `createAnonymousUser`). The lowest possible floor for "anyone should eventually be able to use this."

**Where it's in tension:**
- The accepted cost of a zero-account floor: an anonymous account that's never claimed with an email/Google has **no recovery path** if the device is lost or its storage cleared — decided deliberately (see Hyperactive) rather than engineered around, since building a safety net for it would mean either weakening the zero-friction entry or adding real complexity for a case most users won't hit. Worth revisiting only if it turns out to bite people often in practice.
- No prior notion of accessibility (screen readers, low-vision, motor-impairment tap targets) has come up yet in the codebase — "anyone" should probably include that, not just "anyone with an invite."
- "Free and available to everyone" is a promise about the core loop, not necessarily every future feature — first concrete answer now exists (see Hyperactive, "Whether users ever see their own data"): the check-in-and-move-forward loop is core and free, looking back at your own trend data is the first named paid use case. One example isn't a doctrine yet — worth watching whether future paid features actually follow "self-reflection/analysis is the paid layer" as a consistent rule, or whether that line needs to be restated more generally once a second paid feature is proposed.

---

## 3. Hyperintentional

**Every decision on the app has a reason.** Nothing is there because it defaulted there, or because it was easy, or because a template shipped it that way.

**Why:** this isn't a development-process rule, it's the same philosophy the app exists to promote, applied reflexively. Ping is for guiding a more intentional life — so the thing itself has to be built with that same intentionality, or it's not credible. Inertia and autopilot are fine somewhere; Ping is specifically not that place, in its own code and roadmap as much as in the lives it's trying to touch.

**Where it holds today:**
- The codebase already has a habit of writing the *why* down, not just the *what* — e.g. the grace-period comment on `BLOCK_SWITCH_DELAY_MINUTES` explains why the current-block logic waits before switching, not just that it does ([today.ts:4-8](frontend/src/views/today.ts:4)), and `activeDayStreak`'s doc comment explains why it steps back a day before counting instead of just describing the loop ([analytics.ts:34](backend/src/routes/analytics.ts:34)).

**Where it's in tension:**
- A reason existing and a reason being *written down* are different things, and this principle only asks for the first — that's really Hypervisible's job (below). Concretely: `BLOCK_SWITCH_DELAY_MINUTES` is explained as "why a delay," but not "why 60 minutes and not 30 or 90." The cadence options are exactly `once` / `twice` / `four` ([types.ts:31](backend/src/types.ts:31)) — no `three`, no custom interval. The category set is exactly `friends` / `colleagues` / `family` / `me` ([types.ts](backend/src/types.ts)). These may all be very intentional, but nothing in the repo says so — worth deciding whether "has a reason" needs to become "has a reason, recorded somewhere," which would fold this principle into Hypervisible rather than keeping them separate.

---

## 4. Hypervisible

**No black boxes anywhere** (no offense to LLMs). Every reason is clear and research-backed with defensible methodology.

**Why:** two reasons, not one. First, differentiation — most tools (and most LLMs, no offense) can't explain themselves, and "we can explain exactly why" is a real edge, not just a nice-to-have. Second, ethics — transparency about *why* the app asks what it asks is a commitment, not a marketing angle. Importantly, the underlying research already exists — years of it — it's just never been written down, because until now the only audience for it was you. The gap isn't that the reasoning doesn't exist; it's that it's uncited and undocumented.

**Where it holds today:**
- The reasoning exists in your head, tested over years — that's real substance, not nothing. What's missing is the artifact: nothing in the repo or product currently shows that work to anyone else, including future-you. Worth naming honestly rather than stretching for a positive here.

**Where it's in tension:**
- The check-in questions, category framework, and cadence options are the entire methodology of the app — the thing that's supposed to actually help someone "exist better" — and right now they live as admin-configured free text in KV ([question.ts](backend/src/routes/question.ts), pulling from `config.blocks`), not as a documented, citable methodology anywhere in the repo. If someone asked "why these four categories, why this exact question wording, why yes/no instead of a scale," there's no artifact today that answers that — only what's in your head.
- "Research-backed" is doing double duty: it can mean "grounded in real behavioral-science principles I've internalized over years" (already true) or "cited and defensible to a skeptic" (not yet true, and a much bigger bar — approaching "could hold up as a real intervention"). Worth deciding which bar this principle is actually holding the product to, since building toward the second is a materially bigger and slower undertaking than documenting the first.
- The planned trend feature (see Hyperactive) is where this stops being abstract: sample copy like "work is really messing up your afternoons" is a causal claim, not just a pattern observation — it's telling someone *why* their life is going a certain way. That's exactly the kind of statement Hypervisible commits to being able to defend, and it's a materially higher bar than "these categories are grounded in years of experience" — a wrong or overconfident causal read here could actively mislead someone about their own life. Worth treating trend-copy wording as the first real test case for what "defensible methodology" has to mean in practice, before that feature ships rather than after.
- This is the principle most likely to conflict with Hyperlightweight: "defensible methodology" tends to want more nuance (a 1-5 scale beats yes/no for research validity), while "no typing, four taps" wants less. Worth deciding which one wins when they actually collide, rather than discovering the answer mid-feature.
- Concrete next step, whenever you're ready: a `METHODOLOGY.md` (or a section here) that states, for the current question set and categories, what it's based on — even if the honest answer today is "personal judgment, not yet research-validated." Writing that down *is* the difference between "black box" and "visible," even before the methodology itself improves.

---

## 5. Hyperactive

**Everything drives toward real action and movement, never toward usage or attention.** The app's success metric is what happens in someone's life, not how often they open Ping.

**Why:** a direct rejection of the standard playbook — every other app you've worked on optimized for being *used*; this one is for being *useful*. Crucially, "useful" isn't "satisfying": the goal isn't happier users, it's more intentional ones, and getting more intentional makes a person *harder* to satisfy, not easier — they notice more, tolerate less, expect more of themselves. That's treated as success, not friction. Retention, if it happens, is meant to be a side effect of Ping actually changing someone's behavior and them talking about that change — never an engagement mechanic pursued for its own sake.

**Where it holds today:**
- The core loop already points outward, not inward: the check-in question is about real life ("did today go how you wanted," "did you do the thing with friends/family") — it's self-report on the world, not a request to spend more time in the app. There's no feed, no infinite scroll, nothing designed to be lingered on.
- This is Hyperlightweight's other side of the same coin: minimizing taps and getting users out fast isn't just about ease, it's a structural guard against optimizing for time-in-app.

**What actually gets tracked (backend-only), and why each one is allowed:**
- **Check-in frequency / `activeDayStreak`** ([analytics.ts:34](backend/src/routes/analytics.ts:34)) *is* a legitimate signal after all — not because more usage is inherently good, but because of the specific logic of a two-tap, non-manipulative tool: an app this cheap to answer and this free of dark patterns doesn't get tolerated out of guilt or sunk cost. If it stops being useful, people stop. So sustained voluntary check-ins is evidence the tool is still earning its keep, read as a diagnostic for you, never surfaced to the user as a streak counter or "don't break your streak" nudge — that boundary (backend-only, never user-facing) is what keeps this from becoming the engagement mechanic the principle rejects.
- **Swap-invitation acceptance** — the `detectStreaks` / `acceptRecommendation` mechanic ([recommendations.ts:23](backend/src/recommendations.ts:23), [recommendations.ts:88](backend/src/recommendations.ts:88)) already exists: when a run of same-category answers is detected, Ping proposes re-centering the check-in on that specific thing, and tracks whether the user says Yes to it. This is a sharper signal than the daily Yes/No — accepting a swap invitation is the user explicitly confirming "yes, Ping, that's what I need to work on," which is much closer to "more intentional" than any raw answer-rate could be.

**The one condition that keeps frequency-as-signal honest:**
- It only works because Hyperlightweight keeps the cost near zero and nothing here manufactures a reason to stay. The instant Ping adds anything that pulls people back through guilt, loss-aversion, or nagging (a streak-break notification, a "you're falling behind" message) rather than through the check-ins genuinely earning their spot, frequency stops meaning "this works" and starts meaning "this successfully manipulated someone" — the exact failure mode Hyperactive exists to rule out. Any feature that touches retention should be checked against that line specifically, not just against "does this increase opens."

**How the zero-account onboarding stays on the right side of that line — decided:**
- Not having notifications on still lets you in — Ping's whole loop runs on the nudge, so a persistent (non-blocking, no-dismiss) reminder banner sits on Home every time it's off, reappearing on every visit rather than just once. This is a functional prompt about a permission the product needs to work, not a manipulative one — it never references streaks, time invested, or what you'll lose, and it never blocks the actual check-in card underneath it.
- A second, complementary path now sits alongside that permanent banner: a well-timed, **dismissible** earned nudge ("Would you like quick reminders to answer from?"), fired at most once each at the 1st, 3rd, and 10th follow-up answered overall, and only while notifications are still off ([routes/answer.ts](backend/src/routes/answer.ts)'s `CHECKPOINT_TRIGGERS`). The always-on banner is the guarantee-of-visibility floor; this is the earned, well-timed version layered on top, resolvable with a real No that clears it until the next checkpoint — same non-nagging contract as the banner, just with an exit.
- Suggesting a real email/Google account, by contrast, is capped at exactly **one** appearance ever — fired once, at the 8th follow-up answered overall, and only once notifications are already on and the account has no email yet ([routes/answer.ts](backend/src/routes/answer.ts)'s `CHECKPOINT_TRIGGERS`, `save-account`). Tracked server-side as part of the same earned-nudge queue (not `localStorage`), so it survives a cleared browser and reflects genuine engagement rather than raw days-elapsed. Framed only as "would you like to save your account," never "you'll lose this" — outside that one moment, it's a permanently-available, easy-to-ignore option in Settings, never a proactive nag. The difference between this and the notification nudges is deliberate: one is about the product working at all (can recur), the other is about data safety (say it once, respectfully, then stop).

**Whether users ever see their own data — decided:** the free core stays purely forward-facing (answer, act, move on); looking backward at your own patterns is the paid tier. "If you want to analyze your life, that's on you — we're here to keep it moving." When that surface does ship, it's explicitly **trends, not streaks** — e.g. "your mornings tend to go wrong," "work is really messing up your afternoons" — pattern insight about your life, not a gamified count of your app usage. This is also the first concrete answer to the free/paid line Hyperavailable left open (see below): self-reflection and analysis are a "use case," the check-in loop itself is core.

---

*Add principles here as they come up. Keep the "where it's in tension" sections honest — the point of writing this down is to make the gaps visible, not to grade the app as finished.*
