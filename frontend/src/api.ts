const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export type Category = "friends" | "work" | "home" | "capacity";
export type BlockId = "1" | "2";
export type Answer = "yes" | "no";
export type FollowupVariant = "what" | "why";

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
  existingAnswer: { answer: Answer; variant?: FollowupVariant; category?: Category } | null;
}

export interface AnswerResponse {
  block: BlockId;
  answer: Answer;
  followup: { variant: FollowupVariant } & FollowupPrompt;
}

export interface Cadence {
  block1: string;
  block2: string;
  timezone: string;
}

export interface BlockContent {
  question: { when: string; how: string };
  yes: { what: FollowupPrompt; why: FollowupPrompt };
  no: { what: FollowupPrompt; why: FollowupPrompt };
}

export interface TriggerConfig {
  exactPathThreshold: number;
  categoryVolumeThreshold: number;
  streakThreshold: number;
  retireAfterDays: number;
}

export interface RecommendationCopy {
  amplify: Record<Category, string>;
  resolve: Record<Category, string>;
}

export interface AdminConfig {
  blocks: Record<BlockId, BlockContent>;
  triggers: TriggerConfig;
  recommendationCopy: RecommendationCopy;
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
  signup: (email: string, password: string, inviteToken: string) =>
    request<{ email: string }>("/api/signup", { method: "POST", body: JSON.stringify({ email, password, inviteToken }) }),
  login: (email: string, password: string) =>
    request<{ email: string }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  me: () => request<{ email: string; cadence: Cadence; pushSubscriptionCount: number; isAdmin: boolean }>("/api/me"),

  requestPasswordReset: (email: string) =>
    request<{ ok: true }>("/api/password-reset/request", { method: "POST", body: JSON.stringify({ email }) }),
  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ ok: true }>("/api/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, newPassword }) }),

  sendInvite: (email: string) => request<{ ok: true }>("/api/invite", { method: "POST", body: JSON.stringify({ email }) }),

  getQuestion: (block: BlockId, date?: string) =>
    request<QuestionResponse>(`/api/question?block=${block}${date ? `&date=${date}` : ""}`),
  answer: (block: BlockId, answer: Answer, date?: string) =>
    request<AnswerResponse>("/api/answer", { method: "POST", body: JSON.stringify({ block, answer, date }) }),
  followup: (block: BlockId, category: Category, date?: string) =>
    request<{ ok: true }>("/api/followup", {
      method: "POST",
      body: JSON.stringify({ block, category, date }),
    }),

  updateCadence: (cadence: Partial<Cadence>) =>
    request<{ cadence: Cadence }>("/api/cadence", { method: "POST", body: JSON.stringify(cadence) }),

  getVapidPublicKey: () => request<{ publicKey: string | null }>("/api/push/vapid-public-key"),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<{ ok: true }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
  sendTestPush: (block: BlockId) =>
    request<{ ok: true }>("/api/push/test", { method: "POST", body: JSON.stringify({ block }) }),

  googleSignInUrl: (inviteToken?: string | null) =>
    `${API_BASE}/api/auth/google/start${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""}`,

  getAdminConfig: () => request<AdminConfig>("/api/admin/config"),
  saveAdminConfig: (config: AdminConfig) =>
    request<{ ok: true }>("/api/admin/config", { method: "PUT", body: JSON.stringify(config) }),
};

export { ApiError };
