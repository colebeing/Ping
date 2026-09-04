import type { Env } from "./types";
import { corsHeaders, errorResponse, handlePreflight, HttpError } from "./http";
import { requireAuth, isAdmin } from "./auth";
import { handleLogin, handleLogout, handleRequestPasswordReset, handleConfirmPasswordReset } from "./routes/auth";
import { handleMe } from "./routes/me";
import { handleGetQuestion } from "./routes/question";
import { handleAnswer, handleFollowup } from "./routes/answer";
import { handleListRecommendations, handleAcceptRecommendation, handleDeclineRecommendation, handleUpdateCadence } from "./routes/recommendations";
import { handleSubscribe, handleGetVapidPublicKey, handleTestPush, handleRegisterFcmToken, handleNotificationClicked } from "./routes/push";
import { handleGetAdminConfig, handleSaveAdminConfig, handleGetConfigAuditLog } from "./routes/admin";
import { handleGetAnalytics } from "./routes/analytics";
import { handleGoogleStart, handleGoogleCallback, handleGoogleTokenSignIn } from "./routes/googleAuth";
import { handleStartAnonymous, handleClaimWithPassword, handleClaimWithGoogle } from "./routes/account";
import { PushScheduler } from "./scheduler";

export { PushScheduler };

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === "OPTIONS") return handlePreflight(request, env);

  if (pathname === "/api/login" && method === "POST") return handleLogin(request, env);
  if (pathname === "/api/logout" && method === "POST") return handleLogout(request, env);
  if (pathname === "/api/push/vapid-public-key" && method === "GET") return handleGetVapidPublicKey(request, env);
  if (pathname === "/api/password-reset/request" && method === "POST") return handleRequestPasswordReset(request, env);
  if (pathname === "/api/password-reset/confirm" && method === "POST") return handleConfirmPasswordReset(request, env);
  if (pathname === "/api/auth/google/start" && method === "GET") return handleGoogleStart(request, env);
  if (pathname === "/api/auth/google/callback" && method === "GET") return handleGoogleCallback(request, env);
  if (pathname === "/api/auth/google/token" && method === "POST") return handleGoogleTokenSignIn(request, env);
  if (pathname === "/api/account/start" && method === "POST") return handleStartAnonymous(request, env);

  // Everything below requires a session.
  const userId = await requireAuth(request, env);
  if (!userId) return errorResponse("Not authenticated", 401);

  if (pathname === "/api/me" && method === "GET") return handleMe(request, env, userId);
  if (pathname === "/api/question" && method === "GET") return handleGetQuestion(request, env, userId);
  if (pathname === "/api/answer" && method === "POST") return handleAnswer(request, env, userId);
  if (pathname === "/api/followup" && method === "POST") return handleFollowup(request, env, userId);
  if (pathname === "/api/recommendations" && method === "GET") return handleListRecommendations(request, env, userId);
  if (pathname === "/api/cadence" && method === "POST") return handleUpdateCadence(request, env, userId);
  if (pathname === "/api/push/subscribe" && method === "POST") return handleSubscribe(request, env, userId);
  if (pathname === "/api/push/register-fcm" && method === "POST") return handleRegisterFcmToken(request, env, userId);
  if (pathname === "/api/push/test" && method === "POST") return handleTestPush(request, env, userId);
  if (pathname === "/api/push/clicked" && method === "POST") return handleNotificationClicked(request, env, userId);
  if (pathname === "/api/account/claim/password" && method === "POST") return handleClaimWithPassword(request, env, userId);
  if (pathname === "/api/account/claim/google" && method === "POST") return handleClaimWithGoogle(request, env, userId);

  const acceptMatch = pathname.match(/^\/api\/recommendations\/([^/]+)\/accept$/);
  if (acceptMatch && method === "POST") return handleAcceptRecommendation(request, env, userId, acceptMatch[1]);

  const declineMatch = pathname.match(/^\/api\/recommendations\/([^/]+)\/decline$/);
  if (declineMatch && method === "POST") return handleDeclineRecommendation(request, env, userId, declineMatch[1]);

  if (pathname === "/api/admin/config") {
    if (!(await isAdmin(env, userId))) return errorResponse("Admin access required", 403);
    if (method === "GET") return handleGetAdminConfig(request, env);
    if (method === "PUT") return handleSaveAdminConfig(request, env, userId);
  }

  if (pathname === "/api/admin/config/history") {
    if (!(await isAdmin(env, userId))) return errorResponse("Admin access required", 403);
    if (method === "GET") return handleGetConfigAuditLog(request, env);
  }

  if (pathname === "/api/admin/analytics") {
    if (!(await isAdmin(env, userId))) return errorResponse("Admin access required", 403);
    if (method === "GET") return handleGetAnalytics(request, env);
  }

  return errorResponse("Not found", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await route(request, env);
      return withCors(response, request, env);
    } catch (err) {
      if (err instanceof HttpError) return withCors(errorResponse(err.message, err.status), request, env);
      console.error(err);
      return withCors(errorResponse("Internal error", 500), request, env);
    }
  },
};
