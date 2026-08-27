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

/** "combined" is the single once-daily question — a real third block, not block "1" or "2" repurposed, so it keeps its own history/streaks/escalation independent of whichever twice-daily blocks it isn't currently replacing. */
export type BlockId = "1" | "2" | "combined";
export const TWICE_DAILY_BLOCKS: BlockId[] = ["1", "2"];
export const ALL_BLOCKS: BlockId[] = ["1", "2", "combined"];
export function isBlockId(value: unknown): value is BlockId {
  return value === "1" || value === "2" || value === "combined";
}
export type Frequency = "twice" | "once";
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
  createdAt: string; // ISO date
}

export interface AnswerRecord {
  date: string; // YYYY-MM-DD, user-local
  block: BlockId;
  answer: Answer;
  category?: Category;
  timestamp: string; // ISO
}

export interface BranchEvent {
  kind: "exact-path" | "category-volume";
  pathKey?: string;
  category: Category;
  count: number;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface Cadence {
  block1: string; // "HH:MM" 24h, user-local — also "the" check-in time when frequency is "once"
  block2: string;
  timezone: string; // IANA tz name
  frequency: Frequency;
}

export interface UserState {
  pathCounts: Record<string, number>;
  categoryCounts: Record<Category, number>;
  answers: AnswerRecord[];
  activeOverrides: Partial<Record<BlockId, QuestionOverride>>;
  retiredOverrides: QuestionOverride[];
  pendingRecommendations: Recommendation[];
  cadence: Cadence;
  pushSubscriptions: PushSubscriptionJSON[];
  /** FCM registration tokens for the native Android wrapper — separate from pushSubscriptions (Web Push). */
  fcmTokens: string[];
  lastNotified: Partial<Record<BlockId, string>>; // date string per block
}

export interface UserRecord {
  id: string; // normalized email
  email: string;
  passwordHash: string;
  salt: string;
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

export interface InviteToken {
  email: string; // normalized — the invite may only be redeemed by this exact email
  invitedBy: string;
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
  /** Frontend origin for building reset/invite links, e.g. "https://colebeing.github.io/Ping". */
  FRONTEND_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Firebase service account JSON (as a string), used to sign FCM HTTP v1 API requests for the Android wrapper. */
  FCM_SERVICE_ACCOUNT_JSON?: string;
}
