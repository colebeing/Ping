export type Category = "friends" | "colleagues" | "family" | "me";

// Path-key letter codes, per spec notation {block}{y/n}{category}.
export const CATEGORY_CODE: Record<Category, string> = {
  friends: "a",
  colleagues: "b",
  family: "c",
  me: "d",
};

export const CATEGORIES: Category[] = ["friends", "colleagues", "family", "me"];

export type NeedQuadrant = "be" | "become" | "believe" | "belong";

// Backend-only. Users never see quadrant names, only who labels.
export const DOMAIN_NEED_MAP: Record<Category, NeedQuadrant[]> = {
  friends: ["belong"],
  colleagues: ["become", "be", "believe", "belong"],
  family: ["be", "belong"],
  me: ["be", "become", "believe", "belong"],
};

/** The only four blocks live going forward — fixed morning/midday/afternoon/evening identities. */
export type LiveBlockId = "q1" | "q2" | "q3" | "q4";
export const LIVE_BLOCKS: LiveBlockId[] = ["q1", "q2", "q3", "q4"];
export function isLiveBlockId(value: unknown): value is LiveBlockId {
  return typeof value === "string" && (LIVE_BLOCKS as string[]).includes(value);
}

/** "1"/"2"/"combined" are frozen legacy ids from the old twice-/once-daily cadence modes — never
 * written to again (see isLiveBlockId, which write paths check instead), kept only so AnswerRecord/
 * admin config history already recorded under them keeps reading correctly. */
export type BlockId = LiveBlockId | "1" | "2" | "combined";
export const ALL_BLOCKS: BlockId[] = ["1", "2", "combined", ...LIVE_BLOCKS];
export function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && (ALL_BLOCKS as string[]).includes(value);
}
export type Answer = "yes" | "no";

export interface FollowupPrompt {
  /** The follow-up question text itself, e.g. "Who made it work?" */
  prompt: string;
  /** Tap-to-select answer option labels, one per category. */
  options: Record<Category, string>;
}

/** WHY is now the only follow-up (WHAT was dropped) — one prompt per answer valence. */
export interface BlockContent {
  /** The complete question, e.g. "Did today start how you wanted?" — one fully-written string, not
   * composed from separate WHEN/HOW slots, so admins have full control over phrasing per block. */
  question: string;
  yes: FollowupPrompt;
  no: FollowupPrompt;
}

/** Frozen legacy blocks only — "1"/"2"/"combined" content, never edited again, kept purely so History
 * reads old answered days correctly. Live q1-q4 content lives in QuestionRoot instead. */
export interface AppConfig {
  blocks: Record<"1" | "2" | "combined", BlockContent>;
}

/** One entry per admin config save — global (not per-user), capped to the most recent 50. */
export interface ConfigAuditEntry {
  editedBy: string; // userId
  editedAt: string; // ISO
}

export interface TriggerConfig {
  /** Same exact path (block+answer+category) repeats this many times → branch trigger. */
  exactPathThreshold: number;
  /** Same category hit this many times total across different paths → branch trigger. */
  categoryVolumeThreshold: number;
  /** Consecutive same-category, same-valence days → a recommendation is proposed. */
  streakThreshold: number;
  /** Days an accepted recommendation must hold (no "no" answer) before it retires. */
  retireAfterDays: number;
}

/** One step down the escalation tree: which valence-branch and which category (null = the general,
 * mixed-category slot) was taken. A full EscalationPath is how a node is found from the root. */
export interface EscalationStep {
  valence: "amplify" | "resolve";
  category: Category | null;
}
/** [] means the root routine question itself — not any EscalationNode. */
export type EscalationPath = EscalationStep[];

/** One node in the escalation tree — the routine question a swap invite produces once accepted (or,
 * recursively, a swap invite ONE of ITS OWN follow-up answers produces). A complete, block-agnostic
 * question (no when/how composition, and no per-block variants — unlike the root, it never needs one:
 * only the single block whose streak produced it is ever overridden with it), its own yes/no
 * follow-up, and its own set of further swap invites. An absent slot in `children` means "not yet
 * authored" — never falls back to some default, see EscalationChildren. */
export interface EscalationNode {
  question: string;
  yes: FollowupPrompt;
  no: FollowupPrompt;
  children: EscalationChildren;
}

/** Up to 10 possible next swap invites from a node (root or any deeper EscalationNode): one per
 * category per valence (4 x 2 = 8), plus a general yes-streak and general no-streak slot for when a
 * streak holds across mixed categories with no single one driving it. Every slot starts absent —
 * admins author only as deep as they choose to; an absent slot means no swap invite is ever proposed
 * there, not a default one. */
export interface EscalationChildren {
  amplify: Partial<Record<Category, EscalationNode>>;
  resolve: Partial<Record<Category, EscalationNode>>;
  generalYes?: EscalationNode;
  generalNo?: EscalationNode;
}

/** The whole live question tree: the root routine question (Type 1: 4 per-block formulations; Type 2:
 * one shared follow-up — every block's yes/no was already identical, mirrored on every Admin save, so
 * this just stops storing 4 redundant copies of it) plus however deep admins have actually built
 * escalation (Type 3/4, recursively, via `children`). Replaces RecommendationCopy entirely. */
export interface QuestionRoot {
  blockQuestions: Record<LiveBlockId, string>;
  yes: FollowupPrompt;
  no: FollowupPrompt;
  children: EscalationChildren;
}

export interface QuestionOverride {
  /** How to re-find this override's originating node from the root — [] is impossible for a real
   * override (accepting one always takes at least one step), kept as EscalationPath's own type rather
   * than a non-empty variant since a defensive resolveNode(root, []) reading "root" is harmless. */
  path: EscalationPath;
  /** The complete text for the one block this override applies to — denormalized from the node at
   * `path` (snapshotted at accept time) so every existing simple read of it stays a plain field. */
  question: string;
  yes: FollowupPrompt;
  no: FollowupPrompt;
  /** Denormalized from path's last step — null when it came from a generalYes/generalNo slot. */
  category: Category | null;
  acceptedAt: string; // ISO date
}

/** Fields every kind of nudge carries, regardless of what it's about. */
interface NudgeBase {
  id: string;
  createdAt: string; // ISO date
}

/** The original "swap invitation" mechanic — a content-adaptation nudge, proposing to change a
 * block's question going forward, triggered by a streak in the user's own answer history. One kind
 * of nudge among several now, not a separate system — see UserState.pendingNudges. */
export interface RecommendationNudge extends NudgeBase {
  kind: "recommendation";
  /** Always a live block — detectStreaks only ever scans LIVE_BLOCKS (see recommendations.ts). */
  block: LiveBlockId;
  /** The full path this proposes moving to (one step deeper than the block's current active path) —
   * accepting sets activeOverrides[block].path to exactly this. */
  path: EscalationPath;
  /** The proposed node's own content — no tree/config lookup needed to accept. */
  node: { question: string; yes: FollowupPrompt; no: FollowupPrompt };
  /** Denormalized from path's last step — display/logging convenience only, never used for dedup
   * (two different nodes can share a trailing step; only a full-path compare tells them apart). */
  category: Category | null;
  valence: "amplify" | "resolve";
  /** Date of the most recent answer counted into the streak that produced this — the floor a fresh streak must clear after a decline, see DeclinedStreak. */
  asOfDate: string;
}

/** Asks to enable push notifications — triggered by a global follow-up-count checkpoint, not tied to
 * any block/category. Fires only while notifications are still off. */
export interface NotificationPermissionNudge extends NudgeBase {
  kind: "notification-permission";
  checkpoint: number;
}

/** Asks an anonymous user to save their account (add an email) — fires only once notifications are
 * already on, at a later checkpoint than the notification nudge itself. */
export interface SaveAccountNudge extends NudgeBase {
  kind: "save-account";
  checkpoint: number;
}

// invite-friend: deliberately not added yet — no trigger, no destination flow exists. Add a fourth
// variant here (and a row in backend/src/routes/answer.ts's CHECKPOINT_TRIGGERS) once that flow does.
export type Nudge = RecommendationNudge | NotificationPermissionNudge | SaveAccountNudge;

/** Marks "the user already said no to this exact streak" so detectStreaks doesn't re-propose it
 * every single day the pattern continues. Only entries strictly after asOfDate count toward a
 * fresh run for this block+category+valence — the user's own framing: decline a streak of 2
 * family answers, and it needs 2 *new* family answers before it can ask again. */
export interface DeclinedStreak {
  category: Category | null;
  valence: "amplify" | "resolve";
  asOfDate: string;
}

export interface AnswerRecord {
  date: string; // YYYY-MM-DD, user-local
  block: BlockId;
  answer: Answer;
  category?: Category;
  timestamp: string; // ISO
}

/** Recorded when an existing answer/category is genuinely changed (not the "resume an in-progress card" no-op re-post) — answers[] only ever holds the current value, so this is the only trail of what it used to say. */
export interface AnswerEditRecord {
  date: string;
  block: BlockId;
  previousAnswer: Answer;
  previousCategory?: Category;
  editedAt: string; // ISO
}

export interface BranchEvent {
  kind: "exact-path" | "category-volume";
  pathKey?: string;
  category: Category;
  count: number;
}

/** One send/click outcome for a single device/channel — lets Analytics tell "sent but never delivered/tapped" apart from "never even sent". */
export interface NotificationEvent {
  block: BlockId;
  kind: "sent" | "failed" | "clicked";
  channel: "webpush" | "fcm";
  timestamp: string; // ISO
}

/** Logged once per push subscription / FCM token registration — the one place OS/browser/app info ever reaches the backend, so platform-specific bugs are visible in aggregate rather than one bug report at a time. */
export interface DeviceRegistration {
  type: "webpush" | "fcm";
  platform: string; // e.g. a User-Agent string, or "android"/"ios" for the native wrapper
  registeredAt: string; // ISO
}

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface Cadence {
  /** "HH:MM" 24h, user-local — one per canonical slot, always all four present even when skipped
   * (so re-enabling a skipped block remembers its last time instead of resetting to a default). */
  times: Record<LiveBlockId, string>;
  /** Which of q1-q4 the user has turned off — never all four; at least one live block is required. */
  skippedBlocks: LiveBlockId[];
  timezone: string; // IANA tz name
}

export interface UserState {
  pathCounts: Record<string, number>;
  categoryCounts: Record<Category, number>;
  answers: AnswerRecord[];
  /** Append-only — never read by app logic, purely a trail for analytics. */
  answerEdits: AnswerEditRecord[];
  activeOverrides: Partial<Record<BlockId, QuestionOverride>>;
  retiredOverrides: QuestionOverride[];
  /** Every kind of earned in-flow prompt — swap invitations, notification/save-account asks, and
   * whatever's added later — one queue, one dismiss endpoint. See types.ts's Nudge union. */
  pendingNudges: Nudge[];
  declinedStreaks: Partial<Record<BlockId, DeclinedStreak>>;
  /** Lifetime count of completed follow-ups (category picked), incremented once per handleFollowup
   * call. Deliberately NOT decremented on edit — unlike pathCounts/categoryCounts, this exists purely
   * to trigger nudge checkpoints once each, not to stay an accurate "current" count. Do not derive
   * this from answers.filter(a => a.category).length instead: handleAnswer wipes an existing record's
   * category on every re-post (including the harmless "resume" case), which would make a derived
   * count non-monotonic and let an already-fired checkpoint re-fire after an edit. */
  totalFollowupsAnswered: number;
  cadence: Cadence;
  pushSubscriptions: PushSubscriptionJSON[];
  /** FCM registration tokens for the native Android wrapper — separate from pushSubscriptions (Web Push). */
  fcmTokens: string[];
  lastNotified: Partial<Record<BlockId, string>>; // date string per block
  /** Append-only send/click log across both push channels. */
  notificationEvents: NotificationEvent[];
  /** Distinct user-local dates the app was opened (every /api/me call), regardless of whether anything was answered — lets "opens but doesn't check in" be told apart from "doesn't open at all". */
  appOpenDates: string[];
  /** One entry per push subscription / FCM token registration. */
  deviceRegistrations: DeviceRegistration[];
}

export interface UserRecord {
  /** Normalized email once claimed; "anon:<uuid>" until then — see auth.ts's claimAccount. */
  id: string;
  /** Absent for an anonymous, not-yet-claimed account. */
  email?: string;
  passwordHash?: string;
  salt?: string;
  createdAt: string;
  isAdmin?: boolean;
}

/** Non-expiring, like DeviceTokenRecord below — a sign-in shouldn't silently log someone out. The
 * cookie carrying this token still has a Max-Age (browsers cap it regardless, ~400 days), but the
 * session itself has no server-side expiry; logout is the only thing that ends it. */
export interface SessionRecord {
  userId: string;
}

/** Long-lived, non-expiring — minted once when the native app registers its FCM token, so a
 * background BroadcastReceiver (no cookie jar, no browser) can still authenticate directly. */
export interface DeviceTokenRecord {
  userId: string;
}

export interface PasswordResetToken {
  userId: string;
  expiresAt: number; // epoch ms
}

export interface Env {
  CONFIG_KV: KVNamespace;
  STATE_KV: KVNamespace;
  PUSH_SCHEDULER: DurableObjectNamespace<import("./scheduler").PushScheduler>;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Comma-separated list of allowed frontend origins for CORS (e.g. the GitHub Pages URL). */
  ALLOWED_ORIGINS?: string;
  RESEND_API_KEY?: string;
  /** e.g. "Ping <onboarding@resend.dev>" — defaults to Resend's shared test address if unset. */
  EMAIL_FROM?: string;
  /** Frontend origin for building password-reset links, e.g. "https://colebeing.github.io/Ping". */
  FRONTEND_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Firebase service account JSON (as a string), used to sign FCM HTTP v1 API requests for the Android wrapper. */
  FCM_SERVICE_ACCOUNT_JSON?: string;
}
