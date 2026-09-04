const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export type Category = "friends" | "colleagues" | "family" | "me";

/** The only four blocks live going forward — fixed morning/midday/afternoon/evening identities. */
export type LiveBlockId = "q1" | "q2" | "q3" | "q4";
export const LIVE_BLOCKS: LiveBlockId[] = ["q1", "q2", "q3", "q4"];
export function isLiveBlockId(value: unknown): value is LiveBlockId {
  return typeof value === "string" && (LIVE_BLOCKS as string[]).includes(value);
}

/** "1"/"2"/"combined" are frozen legacy ids from the old twice-/once-daily cadence modes — never
 * written to again, kept only so History can still read old answered days recorded under them. */
export type BlockId = LiveBlockId | "1" | "2" | "combined";
export const ALL_BLOCKS: BlockId[] = ["1", "2", "combined", ...LIVE_BLOCKS];
export function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && (ALL_BLOCKS as string[]).includes(value);
}
export type Answer = "yes" | "no";

export interface FollowupPrompt {
  prompt: string;
  options: Record<Category, string>;
}

export interface QuestionResponse {
  block: BlockId;
  when: string;
  how: string;
  text: string;
  overridden: boolean;
  existingAnswer: {
    answer: Answer;
    category?: Category;
    followup?: { prompt: string; optionLabel: string };
  } | null;
  /** Only ever set for today's own card — recovers an invitation the user didn't resolve before reloading. */
  pendingRecommendation: RecommendationNudge | null;
}

export interface AnswerResponse {
  block: BlockId;
  answer: Answer;
  followup: FollowupPrompt;
}

export interface Cadence {
  /** "HH:MM" 24h, user-local — one per canonical slot, always all four present even when skipped. */
  times: Record<LiveBlockId, string>;
  /** Which of q1-q4 the user has turned off — never all four. */
  skippedBlocks: LiveBlockId[];
  timezone: string;
}

export interface BlockContent {
  question: { when: string; how: string };
  yes: FollowupPrompt;
  no: FollowupPrompt;
}

export interface TriggerConfig {
  exactPathThreshold: number;
  categoryVolumeThreshold: number;
  streakThreshold: number;
  retireAfterDays: number;
}

/** A full invitation to swap a block's HOW question — as fleshed out as the starter question, with its own yes/no follow-ups. */
export interface Invitation {
  how: string;
  yes: FollowupPrompt;
  no: FollowupPrompt;
}

/** 10 invitations total: one per category per valence (4 x 2), plus a general
 * yes-streak and general no-streak invitation for when no single category drove the streak. */
export interface RecommendationCopy {
  amplify: Record<Category, Invitation>;
  resolve: Record<Category, Invitation>;
  generalYes: Invitation;
  generalNo: Invitation;
}

export interface AdminConfig {
  blocks: Record<BlockId, BlockContent>;
  triggers: TriggerConfig;
  recommendationCopy: RecommendationCopy;
}

interface NudgeBase {
  id: string;
  createdAt: string;
}

/** A live invitation to swap a block's HOW question, proposed after a streak — renders inline per-block. */
export interface RecommendationNudge extends NudgeBase {
  kind: "recommendation";
  block: BlockId;
  category: Category | null;
  valence: "amplify" | "resolve";
  invitation: Invitation;
  asOfDate: string;
}

/** Earned at follow-up totals 1/3/10 while push is off — renders at most one at a time on Home. */
export interface NotificationPermissionNudge extends NudgeBase {
  kind: "notification-permission";
  checkpoint: number;
}

/** Earned at follow-up total 8, once push is already on and the account has no email yet. */
export interface SaveAccountNudge extends NudgeBase {
  kind: "save-account";
  checkpoint: number;
}

export type Nudge = RecommendationNudge | NotificationPermissionNudge | SaveAccountNudge;

export interface FollowupResponse {
  newRecommendations: RecommendationNudge[];
  pendingRecommendations: RecommendationNudge[];
}

export interface AnalyticsUserSummary {
  email: string | null;
  createdAt: string;
  totalAnswers: number;
  lastActive: string | null;
  activeDayStreak: number;
  topCategory: Category | null;
  lastNotification: { block: BlockId; channel: "webpush" | "fcm"; outcome: "sent" | "failed"; timestamp: string } | null;
}

export interface AnalyticsResponse {
  totals: { userCount: number; answerCount: number; activeUsers7d: number; activeUsers30d: number };
  categoryTotals: Record<Category, { yes: number; no: number }>;
  answerBalance: Record<BlockId, { yes: number; no: number }>;
  dailyActivity: { date: string; count: number }[];
  notificationTotals: { sent30d: number; failed30d: number };
  users: AnalyticsUserSummary[];
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? "Request failed", res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  /** Signs in, or creates the account on the spot if the email doesn't have one yet — signing up
   * and signing in are the same action, so there's no separate signup call. */
  login: (email: string, password: string) =>
    request<{ email: string }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  me: () =>
    request<{
      email: string | null;
      createdAt: string | null;
      cadence: Cadence;
      pushSubscriptionCount: number;
      fcmTokenCount: number;
      isAdmin: boolean;
      homeNudge: Nudge | null;
    }>("/api/me"),

  /** The zero-friction entry point — mints an anonymous account + session with no credentials, so
   * granting notifications can be the only thing standing between opening Ping and using it. */
  startAnonymous: () => request<{ email: null }>("/api/account/start", { method: "POST" }),
  claimWithPassword: (email: string, password: string) =>
    request<{ email: string }>("/api/account/claim/password", { method: "POST", body: JSON.stringify({ email, password }) }),
  claimWithGoogleIdToken: (idToken: string) =>
    request<{ email: string }>("/api/account/claim/google", { method: "POST", body: JSON.stringify({ idToken }) }),

  requestPasswordReset: (email: string) =>
    request<{ ok: true }>("/api/password-reset/request", { method: "POST", body: JSON.stringify({ email }) }),
  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ ok: true }>("/api/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, newPassword }) }),

  getQuestion: (block: BlockId, date?: string) =>
    request<QuestionResponse>(`/api/question?block=${block}${date ? `&date=${date}` : ""}`),
  answer: (block: BlockId, answer: Answer, date?: string) =>
    request<AnswerResponse>("/api/answer", { method: "POST", body: JSON.stringify({ block, answer, date }) }),
  followup: (block: BlockId, category: Category, date?: string) =>
    request<FollowupResponse>("/api/followup", {
      method: "POST",
      body: JSON.stringify({ block, category, date }),
    }),

  acceptRecommendation: (id: string) => request<{ ok: true }>(`/api/recommendations/${id}/accept`, { method: "POST" }),
  declineRecommendation: (id: string) => request<{ ok: true }>(`/api/recommendations/${id}/decline`, { method: "POST" }),
  dismissNudge: (id: string) => request<{ ok: true }>(`/api/nudges/${id}/dismiss`, { method: "POST" }),

  updateCadence: (cadence: Partial<Cadence>) =>
    request<{ cadence: Cadence }>("/api/cadence", { method: "POST", body: JSON.stringify(cadence) }),

  getVapidPublicKey: () => request<{ publicKey: string | null }>("/api/push/vapid-public-key"),
  subscribePush: (subscription: PushSubscriptionJSON, platform: string) =>
    request<{ ok: true }>("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription, platform }) }),
  registerFcmToken: (fcmToken: string, platform: string) =>
    request<{ ok: true; deviceToken: string }>("/api/push/register-fcm", { method: "POST", body: JSON.stringify({ fcmToken, platform }) }),
  sendTestPush: (block: BlockId) =>
    request<{ ok: true }>("/api/push/test", { method: "POST", body: JSON.stringify({ block }) }),

  googleSignInUrl: () => `${API_BASE}/api/auth/google/start`,
  loginWithGoogleIdToken: (idToken: string) =>
    request<{ email: string }>("/api/auth/google/token", { method: "POST", body: JSON.stringify({ idToken }) }),

  getAdminConfig: () => request<AdminConfig>("/api/admin/config"),
  saveAdminConfig: (config: AdminConfig) =>
    request<{ ok: true }>("/api/admin/config", { method: "PUT", body: JSON.stringify(config) }),

  getAnalytics: () => request<AnalyticsResponse>("/api/admin/analytics"),
};

export { ApiError };
