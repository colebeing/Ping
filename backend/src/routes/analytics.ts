import type {
  Answer,
  AnswerRecord,
  BlockId,
  Category,
  EscalationPath,
  EscalationStep,
  Env,
  FollowupPrompt,
  NotificationEvent,
  QuestionOverride,
  QuestionRoot,
  UserRecord,
  UserState,
} from "../types";
import { CATEGORIES, CATEGORY_LABEL } from "../types";
import { errorResponse, json } from "../http";
import { getState } from "../state";
import { getQuestionRoot } from "../config";

export interface AnalyticsUserSummary {
  /** The raw KV user id (an email or "anon:<uuid>") — not shown, just the key for drilling into
   * handleGetUserProfile below. */
  id: string;
  email: string | null;
  createdAt: string;
  totalAnswers: number;
  lastActive: string | null;
  activeDayStreak: number;
  topCategory: Category | null;
  /** Most recent send attempt (sent or failed — "clicked" isn't a delivery outcome), so a silently-failing device shows up here instead of only being discoverable by reading raw state. */
  lastNotification: { block: BlockId; channel: NotificationEvent["channel"]; outcome: "sent" | "failed"; timestamp: string } | null;
}

/** One entry per distinct escalation-tree path anyone (across all users) has ever answered under —
 * routine question ([]) always first (even with zero answers, since it's the natural default), the
 * rest ordered most-answered first. Drives the main Analytics page's question dropdown, same idea as
 * QuestionPathBreakdown below but aggregated across every account instead of scoped to one. */
export interface AnalyticsQuestionPath {
  path: EscalationPath;
  label: string;
  totalAnswers: number;
  categoryTotals: Record<Category, { yes: number; no: number }>;
}

export interface AnalyticsResponse {
  totals: { userCount: number; answerCount: number; activeUsers7d: number; activeUsers30d: number };
  categoryTotals: Record<Category, { yes: number; no: number }>;
  answerBalance: Record<BlockId, { yes: number; no: number }>;
  dailyActivity: { date: string; count: number }[];
  /** Send attempts (not clicks) across all users in the last 30 days — a delivery-health signal independent of any one user's history. */
  notificationTotals: { sent30d: number; failed30d: number };
  /** For the Admin Analytics page's question dropdown — see AnalyticsQuestionPath's own doc comment. */
  questionPaths: AnalyticsQuestionPath[];
  users: AnalyticsUserSummary[];
}

/** Every known override acceptance for an account, oldest first — retiredOverrides plus the current
 * activeOverride (if any), each paired with when it took over. Lets a path-less answer (recorded before
 * per-answer path tracking existed) be retroactively attributed to whichever question was actually
 * active when it was answered, instead of assumed to be the routine question by default — see
 * resolvedPath below for why that default alone isn't good enough. */
function overrideTimeline(state: UserState): { path: EscalationPath; acceptedAt: string }[] {
  const entries: QuestionOverride[] = [...state.retiredOverrides, ...(state.activeOverride ? [state.activeOverride] : [])];
  return entries.map((o) => ({ path: o.path, acceptedAt: o.acceptedAt })).sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt));
}

/**
 * The path an answer should be attributed to for grouping purposes: its own recorded path if answer-
 * level tracking already covered it, otherwise whichever timeline entry was active at its timestamp
 * (routine question if that's before the earliest override, or if there's no override history at all).
 *
 * Imperfect for pre-tracking data specifically: an override swapped again before it ever naturally
 * retired leaves no trace in retiredOverrides, so a gap like that reads as whichever override came
 * before or after it instead. Still far more accurate than defaulting every untracked answer to the
 * routine question, which is wrong for the overwhelmingly common real case — an override accepted once
 * and answered under for days before per-answer tracking existed, exactly what "no responses under my
 * new question" turned out to be.
 */
function resolvedPath(a: AnswerRecord, timeline: { path: EscalationPath; acceptedAt: string }[]): EscalationPath {
  if (a.path) return a.path;
  let path: EscalationPath = [];
  for (const entry of timeline) {
    if (entry.acceptedAt <= a.timestamp) path = entry.path;
    else break;
  }
  return path;
}

/** Builds a fresh Record<Category, T> from CATEGORIES instead of spelling out all four keys by hand —
 * `make` runs once per category so each gets its own object, not a shared reference. */
function zeroPerCategory<T>(make: () => T): Record<Category, T> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, make()])) as Record<Category, T>;
}

async function listUserIds(env: Env): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STATE_KV.list({ prefix: "user:", cursor });
    for (const key of page.keys) ids.push(key.name.slice("user:".length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

/** Consecutive days (ending today or yesterday, so an unfinished today doesn't zero out yesterday's run) with at least one answer recorded. */
function activeDayStreak(answers: AnswerRecord[], todayStr: string): number {
  const days = new Set(answers.map((a) => a.date));
  const stepBack = (d: string) => new Date(Date.parse(d + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

  let cursor = days.has(todayStr) ? todayStr : stepBack(todayStr);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = stepBack(cursor);
  }
  return streak;
}

export async function handleGetAnalytics(_request: Request, env: Env): Promise<Response> {
  const [userIds, root] = await Promise.all([listUserIds(env), getQuestionRoot(env)]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const categoryTotals: Record<Category, { yes: number; no: number }> = zeroPerCategory(() => ({ yes: 0, no: 0 }));
  const answerBalance: Record<BlockId, { yes: number; no: number }> = {
    "1": { yes: 0, no: 0 },
    "2": { yes: 0, no: 0 },
    combined: { yes: 0, no: 0 },
    q1: { yes: 0, no: 0 },
    q2: { yes: 0, no: 0 },
    q3: { yes: 0, no: 0 },
    q4: { yes: 0, no: 0 },
  };
  const dailyCounts = new Map<string, number>();
  const users: AnalyticsUserSummary[] = [];
  // Seeded with routine question up front so it's always present (even at 0), same convention as
  // handleGetUserProfile's own per-path breakdown.
  const pathBuckets = new Map<string, { path: EscalationPath; totalAnswers: number; categoryTotals: Record<Category, { yes: number; no: number }> }>();
  pathBuckets.set(pathKey([]), { path: [], totalAnswers: 0, categoryTotals: zeroPerCategory(() => ({ yes: 0, no: 0 })) });
  let answerCount = 0;
  let activeUsers7d = 0;
  let activeUsers30d = 0;
  let sent30d = 0;
  let failed30d = 0;
  const cutoff30Iso = new Date(Date.now() - 30 * 86400000).toISOString();

  for (const userId of userIds) {
    const [user, state] = await Promise.all([env.STATE_KV.get<UserRecord>(`user:${userId}`, "json"), getState(env, userId)]);
    if (!user) continue;

    let lastActive: string | null = null;
    const catCounts: Record<Category, number> = zeroPerCategory(() => 0);
    const timeline = overrideTimeline(state);

    let lastNotification: AnalyticsUserSummary["lastNotification"] = null;
    for (const event of state.notificationEvents) {
      if (event.kind === "clicked") continue;
      if (event.timestamp >= cutoff30Iso) {
        if (event.kind === "sent") sent30d++;
        else failed30d++;
      }
      if (!lastNotification || event.timestamp > lastNotification.timestamp) {
        lastNotification = { block: event.block, channel: event.channel, outcome: event.kind, timestamp: event.timestamp };
      }
    }

    for (const a of state.answers) {
      answerCount++;
      answerBalance[a.block][a.answer]++;
      // Guard against stale category values from before a category rename —
      // an old AnswerRecord (e.g. a pre-rename "work"/"home") isn't a key in
      // these maps, and would otherwise throw and take down analytics for
      // every user over one old record from any single account.
      if (a.category && categoryTotals[a.category]) {
        categoryTotals[a.category][a.answer]++;
        catCounts[a.category]++;
      }
      dailyCounts.set(a.date, (dailyCounts.get(a.date) ?? 0) + 1);
      if (!lastActive || a.date > lastActive) lastActive = a.date;

      const path = resolvedPath(a, timeline);
      const key = pathKey(path);
      let bucket = pathBuckets.get(key);
      if (!bucket) {
        bucket = { path, totalAnswers: 0, categoryTotals: zeroPerCategory(() => ({ yes: 0, no: 0 })) };
        pathBuckets.set(key, bucket);
      }
      bucket.totalAnswers++;
      if (a.category && bucket.categoryTotals[a.category]) bucket.categoryTotals[a.category][a.answer]++;
    }

    if (lastActive && lastActive >= cutoff7) activeUsers7d++;
    if (lastActive && lastActive >= cutoff30) activeUsers30d++;

    let topCategory: Category | null = null;
    let topCount = 0;
    for (const cat of CATEGORIES) {
      if (catCounts[cat] > topCount) {
        topCount = catCounts[cat];
        topCategory = cat;
      }
    }

    users.push({
      id: userId,
      email: user.email ?? null,
      createdAt: user.createdAt,
      totalAnswers: state.answers.length,
      lastActive,
      activeDayStreak: activeDayStreak(state.answers, todayStr),
      topCategory,
      lastNotification,
    });
  }

  users.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  const dailyActivity = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { date, count: dailyCounts.get(date) ?? 0 };
  });

  // Routine question first regardless of its count (the natural default view), the rest by how much
  // data they actually have — most substantial patterns first.
  const routineKey = pathKey([]);
  const questionPaths: AnalyticsQuestionPath[] = [
    ...Array.from(pathBuckets.entries())
      .filter(([key]) => key === routineKey)
      .map(([, b]) => ({ path: b.path, label: pathLabel(root, b.path), totalAnswers: b.totalAnswers, categoryTotals: b.categoryTotals })),
    ...Array.from(pathBuckets.entries())
      .filter(([key]) => key !== routineKey)
      .map(([, b]) => ({ path: b.path, label: pathLabel(root, b.path), totalAnswers: b.totalAnswers, categoryTotals: b.categoryTotals }))
      .sort((a, b) => b.totalAnswers - a.totalAnswers),
  ];

  const response: AnalyticsResponse = {
    totals: { userCount: userIds.length, answerCount, activeUsers7d, activeUsers30d },
    categoryTotals,
    answerBalance,
    dailyActivity,
    notificationTotals: { sent30d, failed30d },
    questionPaths,
    users,
  };
  return json(response);
}

/** yes/no counts per category, this 14-day window vs the previous one, plus all-time — lets the admin
 * read a direction themselves rather than trusting a synthesized trend score over a small sample. */
type CategoryTrend = Record<Category, { last14: { yes: number; no: number }; prior14: { yes: number; no: number }; allTime: { yes: number; no: number } }>;

/**
 * One entry per distinct escalation-tree path this user has actually answered under — the routine
 * question ([]) always first, since every account starts there and it's the natural default view, then
 * whichever swapped-in questions they've experienced, most recently active first. Mixing responses to
 * different questions together would blur the read: a stretch of "yes, environment" answers to the
 * original routine question means something different from the same stretch once the routine question
 * itself has been swapped to something environment-specific. label mirrors the same breadcrumb text
 * admin.ts's tree editor shows for this path, so an admin can find it in the tree from either side.
 */
interface QuestionPathBreakdown {
  path: EscalationPath;
  label: string;
  totalAnswers: number;
  categoryTrend: CategoryTrend;
  recentAnswers: { date: string; block: BlockId; answer: Answer; category: Category | null }[];
}

export interface UserProfileResponse {
  email: string | null;
  createdAt: string;
  timezone: string;
  totalAnswers: number;
  activeDayStreak: number;
  /** The account's current routine question, if a swap invite has been accepted — same denormalized
   * per-block text QuestionOverride already carries, no tree lookup needed. */
  activeQuestion: { text: Record<string, string>; category: Category | null; acceptedAt: string } | null;
  /** What this user has actually accepted, most recent first — shows which content changes actually
   * landed, not just what was offered. No distinct "retired at" timestamp exists in the data (only
   * acceptedAt is ever recorded), so retirement is a status, not a date. */
  overrideHistory: { question: string; category: Category | null; valence: Answer; acceptedAt: string; status: "active" | "retired" }[];
  /** For the Admin per-user page's question-path dropdown — see QuestionPathBreakdown's own doc comment. */
  questionPaths: QuestionPathBreakdown[];
}

function emptyCategoryTrend(): CategoryTrend {
  const empty = () => ({ yes: 0, no: 0 });
  return zeroPerCategory(() => ({ last14: empty(), prior14: empty(), allTime: empty() }));
}

/** JSON-stable key for an EscalationPath, for dedup/grouping — same convention sheets.ts's own
 * (unexported, separately-kept) pathKey uses. */
function pathKey(path: EscalationPath): string {
  return JSON.stringify(path);
}

/** A step's real label is whatever the PARENT node's own yes/no option text says for that category
 * (the literal button an end user tapped), falling back to CATEGORY_LABEL only while that text is
 * genuinely still blank — same rule frontend/src/views/admin.ts's dynamicStepLabel applies, kept as a
 * separate backend copy since the two projects share no module. Prefixed with which valence this step
 * came from ("Yes: "/"No: ") — the category/button text alone doesn't say whether it was reached via a
 * yes-streak or a no-streak, and two different nodes can share the same category under opposite
 * valences. */
function stepLabel(step: EscalationStep, parentYes: FollowupPrompt, parentNo: FollowupPrompt): string {
  if (step.category === null) return step.valence === "yes" ? "Mixed (yes-streak)" : "Mixed (no-streak)";
  const prompt = step.valence === "yes" ? parentYes : parentNo;
  const label = prompt.options[step.category] || CATEGORY_LABEL[step.category];
  return `${step.valence === "yes" ? "Yes" : "No"}: ${label}`;
}

/** Breadcrumb-style label for a path, e.g. "Friends → Mixed (no-streak)" — walks the LIVE tree from the
 * root, so it reads exactly like admin.ts's own breadcrumbs. If the tree has since been restructured and
 * a step along the way no longer resolves, stops there rather than guessing at deeper steps — the path
 * itself (returned alongside the label) still uniquely identifies which answers belong to it regardless
 * of whether the tree still has a live node at that position. */
function pathLabel(root: QuestionRoot, path: EscalationPath): string {
  if (path.length === 0) return "Routine question";
  const labels: string[] = [];
  let parentYes = root.yes;
  let parentNo = root.no;
  let children = root.children;
  for (const step of path) {
    labels.push(stepLabel(step, parentYes, parentNo));
    const node = step.category === null ? (step.valence === "yes" ? children.generalYes : children.generalNo) : children[step.valence][step.category];
    if (!node) break;
    parentYes = node.yes;
    parentNo = node.no;
    children = node.children;
  }
  return labels.join(" → ");
}

/** Denormalizes an override's 4-block question into one representative string for a human-scannable
 * history list — overrideHistory isn't the tree editor, it doesn't need the full per-block shape. */
function overrideQuestionSummary(override: QuestionOverride): string {
  return override.blockQuestions.q1 || Object.values(override.blockQuestions).find((q) => q) || "(no question text)";
}

/** Valence isn't stored directly on QuestionOverride — it's the last step of the path that produced it. */
function overrideValence(override: QuestionOverride): Answer {
  return override.path[override.path.length - 1]?.valence ?? "yes";
}

export async function handleGetUserProfile(_request: Request, env: Env, id: string): Promise<Response> {
  const user = await env.STATE_KV.get<UserRecord>(`user:${id}`, "json");
  if (!user) return errorResponse("User not found", 404);
  const [state, root] = await Promise.all([getState(env, id), getQuestionRoot(env)]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const cutoff28 = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);

  // Every distinct path this user has actually answered under, or currently/previously had active —
  // [] (routine question) always first regardless of whether it has answers of its own, since every
  // account starts there and it's the natural default view. The rest ordered most-recently-active
  // first, so a currently-swapped-in question sits right under routine.
  const pathOrder: { path: EscalationPath; acceptedAt: string }[] = [];
  if (state.activeOverride) pathOrder.push({ path: state.activeOverride.path, acceptedAt: state.activeOverride.acceptedAt });
  for (const o of state.retiredOverrides) pathOrder.push({ path: o.path, acceptedAt: o.acceptedAt });
  const seen = new Map<string, { path: EscalationPath; acceptedAt: string }>();
  for (const entry of pathOrder) {
    const key = pathKey(entry.path);
    const existing = seen.get(key);
    if (!existing || entry.acceptedAt > existing.acceptedAt) seen.set(key, entry);
  }
  const distinctPaths: EscalationPath[] = [
    [],
    ...Array.from(seen.values())
      .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))
      .map((e) => e.path),
  ];

  // resolvedPath, not a raw `a.path ?? []` default — an answer recorded before per-answer path
  // tracking existed still gets attributed to whichever question was actually active when it was
  // answered, via the account's own override timeline. See resolvedPath's own doc comment.
  const timeline = overrideTimeline(state);
  const answersByPath = new Map<string, AnswerRecord[]>();
  for (const a of state.answers) {
    const key = pathKey(resolvedPath(a, timeline));
    const list = answersByPath.get(key);
    if (list) list.push(a);
    else answersByPath.set(key, [a]);
  }

  const questionPaths: QuestionPathBreakdown[] = distinctPaths.map((path) => {
    const answers = answersByPath.get(pathKey(path)) ?? [];
    const categoryTrend = emptyCategoryTrend();
    for (const a of answers) {
      // Guard against stale category values from before a category rename, same as handleGetAnalytics.
      if (!a.category || !categoryTrend[a.category]) continue;
      const bucket = categoryTrend[a.category];
      bucket.allTime[a.answer]++;
      if (a.date >= cutoff14) bucket.last14[a.answer]++;
      else if (a.date >= cutoff28) bucket.prior14[a.answer]++;
    }
    const recentAnswers = [...answers]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 20)
      .map((a) => ({ date: a.date, block: a.block, answer: a.answer, category: a.category ?? null }));
    return { path, label: pathLabel(root, path), totalAnswers: answers.length, categoryTrend, recentAnswers };
  });

  const overrideHistory: UserProfileResponse["overrideHistory"] = [
    ...(state.activeOverride
      ? [
          {
            question: overrideQuestionSummary(state.activeOverride),
            category: state.activeOverride.category,
            valence: overrideValence(state.activeOverride),
            acceptedAt: state.activeOverride.acceptedAt,
            status: "active" as const,
          },
        ]
      : []),
    ...state.retiredOverrides.map((o) => ({
      question: overrideQuestionSummary(o),
      category: o.category,
      valence: overrideValence(o),
      acceptedAt: o.acceptedAt,
      status: "retired" as const,
    })),
  ].sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));

  const response: UserProfileResponse = {
    email: user.email ?? null,
    createdAt: user.createdAt,
    timezone: state.cadence.timezone,
    totalAnswers: state.answers.length,
    activeDayStreak: activeDayStreak(state.answers, todayStr),
    activeQuestion: state.activeOverride
      ? { text: state.activeOverride.blockQuestions, category: state.activeOverride.category, acceptedAt: state.activeOverride.acceptedAt }
      : null,
    overrideHistory,
    questionPaths,
  };
  return json(response);
}
