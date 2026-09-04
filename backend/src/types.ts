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

/** "combined" is the single once-daily question, and "q1"-"q4" are the four-times-daily questions — real blocks of their own, not blocks "1"/"2" repurposed, so each keeps its own history/streaks/escalation independent of whichever other blocks it isn't currently replacing. */
export type BlockId = "1" | "2" | "combined" | "q1" | "q2" | "q3" | "q4";
export const TWICE_DAILY_BLOCKS: BlockId[] = ["1", "2"];
export const FOUR_DAILY_BLOCKS: BlockId[] = ["q1", "q2", "q3", "q4"];
export const ALL_BLOCKS: BlockId[] = ["1", "2", "combined", "q1", "q2", "q3", "q4"];
export function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && (ALL_BLOCKS as string[]).includes(value);
}
export type Frequency = "twice" | "once" | "four";
export type Answer = "yes" | "no";

export interface QuestionTemplate {
  /** e.g. "today start" — the WHEN slot */
  when: string;
  /** e.g. "how you wanted" — the HOW slot */
  how: string;
}

export interface FollowupPrompt {
  /** The follow-up question text itself, e.g. "Who made it work?" */
  prompt: string;
  /** Tap-to-select answer option labels, one per category. */
  options: Record<Category, string>;
}

/** WHY is now the only follow-up (WHAT was dropped) — one prompt per answer valence. */
export interface BlockContent {
  question: QuestionTemplate;
  yes: FollowupPrompt;
  no: FollowupPrompt;
}

export interface AppConfig {
  blocks: Record<BlockId, BlockContent>;
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

/** A full invitation to swap the block's HOW question — as fleshed out as the starter question, with its own yes/no follow-ups. */
export interface Invitation {
  how: string;
  yes: FollowupPrompt;
  no: FollowupPrompt;
}

/** Up to 10 invitations admins can configure: one per category per valence (4 x 2 = 8),
 * plus one for a yes-streak and one for a no-streak that don't share a common category. */
export interface RecommendationCopy {
  amplify: Record<Category, Invitation>;
  resolve: Record<Category, Invitation>;
  generalYes: Invitation;
  generalNo: Invitation;
}

export interface QuestionOverride {
  when: string;
  how: string;
  yes: FollowupPrompt;
  no: FollowupPrompt;
  /** null when this came from a generalYes/generalNo invitation (no single category drove it). */
  category: Category | null;
  acceptedAt: string; // ISO date
}

export interface Recommendation {
  id: string;
  block: BlockId;
  /** null when this is a generalYes/generalNo invitation (streak held across mixed categories). */
  category: Category | null;
  valence: "amplify" | "resolve";
  invitation: Invitation;
  /** Date of the most recent answer counted into the streak that produced this — the floor a fresh streak must clear after a decline, see DeclinedStreak. */
  asOfDate: string;
  createdAt: string; // ISO date
}

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
  block1: string; // "HH:MM" 24h, user-local — also "the" check-in time when frequency is "once"
  block2: string;
  block3?: string; // only meaningful when frequency is "four"
  block4?: string;
  timezone: string; // IANA tz name
  frequency: Frequency;
}

export interface UserState {
  pathCounts: Record<string, number>;
  categoryCounts: Record<Category, number>;
  answers: AnswerRecord[];
  /** Append-only — never read by app logic, purely a trail for analytics. */
  answerEdits: AnswerEditRecord[];
  activeOverrides: Partial<Record<BlockId, QuestionOverride>>;
  retiredOverrides: QuestionOverride[];
  pendingRecommendations: Recommendation[];
  declinedStreaks: Partial<Record<BlockId, DeclinedStreak>>;
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

export interface SessionRecord {
  userId: string;
  expiresAt: number; // epoch ms
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
