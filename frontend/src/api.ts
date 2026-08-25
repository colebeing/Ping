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

export interface Recommendation {
  id: string;
  block: BlockId;
  category: Category;
  valence: "amplify" | "resolve";
  suggestedHow: string;
  createdAt: string;
}

export interface Cadence {
  block1: string;
  block2: string;
  timezone: string;
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
  signup: (email: string, password: string) =>
    request<{ email: string }>("/api/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ email: string }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
  me: () => request<{ email: string; cadence: Cadence; pushSubscriptionCount: number }>("/api/me"),

  getQuestion: (block: BlockId) => request<QuestionResponse>(`/api/question?block=${block}`),
  answer: (block: BlockId, answer: Answer) =>
    request<AnswerResponse>("/api/answer", { method: "POST", body: JSON.stringify({ block, answer }) }),
  followup: (block: BlockId, category: Category) =>
    request<{ pendingRecommendations: Recommendation[] }>("/api/followup", {
      method: "POST",
      body: JSON.stringify({ block, category }),
    }),

  listRecommendations: () =>
    request<{ pending: Recommendation[]; active: Partial<Record<BlockId, unknown>> }>("/api/recommendations"),
  acceptRecommendation: (id: string) => request(`/api/recommendations/${id}/accept`, { method: "POST" }),

  updateCadence: (cadence: Partial<Cadence>) =>
    request<{ cadence: Cadence }>("/api/cadence", { method: "POST", body: JSON.stringify(cadence) }),

  getVapidPublicKey: () => request<{ publicKey: string | null }>("/api/push/vapid-public-key"),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<{ ok: true }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
  sendTestPush: (block: BlockId) =>
    request<{ ok: true }>("/api/push/test", { method: "POST", body: JSON.stringify({ block }) }),
};

export { ApiError };
