export type Category = "friends" | "work" | "home" | "capacity";

// Path-key letter codes, per spec notation {block}{y/n}{A/B}{category}.
export const CATEGORY_CODE: Record<Category, string> = {
  friends: "a",
  work: "b",
  home: "c",
  capacity: "d",
};

export const CATEGORIES: Category[] = ["friends", "work", "home", "capacity"];

export type NeedQuadrant = "be" | "become" | "believe" | "belong";

// Backend-only. Users never see quadrant names, only domain labels.
export const DOMAIN_NEED_MAP: Record<Category, NeedQuadrant[]> = {
  friends: ["belong"],
  work: ["become", "be", "believe", "belong"],
  home: ["be", "belong"],
  capacity: ["be", "become", "believe", "belong"],
};

export type BlockId = "1" | "2";
export type Answer = "yes" | "no";
export type FollowupVariant = "what" | "why"; // "a" / "b" in path notation

export interface QuestionTemplate {
  /** e.g. "today start" — the WHEN slot */
  when: string;
  /** e.g. "how you wanted" — the HOW slot */
  how: string;
}

export interface FollowupPrompt {
  /** The follow-up question text itself, e.g. "What happened?" */
  prompt: string;
  /** Category-flavored answer option labels — placeholder copy pending real content doc */
  options: Record<Category, string>;
}

export interface BlockContent {
  question: QuestionTemplate;
  yes: { what: FollowupPrompt; why: FollowupPrompt };
  no: { what: FollowupPrompt; why: FollowupPrompt };
}

export interface AppConfig {
  blocks: Record<BlockId, BlockContent>;
}

export interface QuestionOverride {
  when: string;
  how: string;
  category: Category;
  acceptedAt: string; // ISO date
}

export interface Recommendation {
  id: string;
  block: BlockId;
  category: Category;
  valence: "amplify" | "resolve";
  suggestedHow: string;
  createdAt: string; // ISO date
}

export interface AnswerRecord {
  date: string; // YYYY-MM-DD, user-local
  block: BlockId;
  answer: Answer;
  what?: Category;
  why?: Category;
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
  block1: string; // "HH:MM" 24h, user-local
  block2: string;
  timezone: string; // IANA tz name
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
  lastNotified: Partial<Record<BlockId, string>>; // date string per block
}

export interface UserRecord {
  id: string; // normalized email
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export interface SessionRecord {
  userId: string;
  expiresAt: number; // epoch ms
}

export interface Env {
  CONFIG_KV: KVNamespace;
  STATE_KV: KVNamespace;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Comma-separated list of allowed frontend origins for CORS (e.g. the GitHub Pages URL). */
  ALLOWED_ORIGINS?: string;
}
