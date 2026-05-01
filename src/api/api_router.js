import { handleGoogleLogin, handleLogout, handleMe } from '../core/auth.js';
import {
  exactAdminApiRouteHandler,
  handleDynamicAdminRoutes
} from './admin_api.js';
import { handleDynamicChatRoutes } from './chat_api.js';
import { handleDynamicSignalRoutes } from './signal_api.js';
import {
  exactFriendsApiRouteHandler,
  handleDynamicFriendRoutes
} from './friends_api.js';
import { exactLlmBotApiRouteHandler } from './llm_bot_api.js';
import { exactNotificationsApiRouteHandler } from './notifications_api.js';
import {
  exactRoomsApiRouteHandler,
  handleDynamicRoomRoutes
} from './rooms_api.js';
import {
  handleDeleteAvatarImage,
  handleGetCurrentUser,
  handleUpdateCurrentUser,
  handleUpdateLlmBotSettings,
  handleUpdateLocale,
  handleUpdateThemeMode,
  handleUpdateUiPreferences,
  handleUploadAvatarImage
} from '../features/users.js';
import { corsHeaders, jsonResponse } from '../core/utils.js';
import { checkRateLimit, rateLimitHeaders } from '../core/rate_limit.js';

async function handleHealth(request) {
  return jsonResponse({ ok: true, message: 'taiwan brawl api alive' }, 200, request);
}

function exactApiRouteHandler(request, env, url) {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/health':
      return () => handleHealth(request);
    case 'GET /api/me':
      return () => handleMe(request, env);
    case 'GET /api/users/me':
      return () => handleGetCurrentUser(request, env);
    case 'PUT /api/users/me':
      return () => handleUpdateCurrentUser(request, env);
    case 'POST /api/users/me/avatar-image':
      return () => handleUploadAvatarImage(request, env);
    case 'DELETE /api/users/me/avatar-image':
      return () => handleDeleteAvatarImage(request, env);
    case 'PUT /api/users/theme-mode':
      return () => handleUpdateThemeMode(request, env);
    case 'PUT /api/users/ui-preferences':
      return () => handleUpdateUiPreferences(request, env);
    case 'PUT /api/users/locale':
      return () => handleUpdateLocale(request, env);
    case 'PUT /api/users/llm-bot-settings':
      return () => handleUpdateLlmBotSettings(request, env);
    case 'POST /api/logout':
      return () => handleLogout(request, env);
    case 'POST /api/google-login':
      return () => handleGoogleLogin(request, env);
    default:
      return (
        exactLlmBotApiRouteHandler(request, env, url) ??
        exactNotificationsApiRouteHandler(request, env, url) ??
        exactAdminApiRouteHandler(request, env, url) ??
        exactFriendsApiRouteHandler(request, env, url) ??
        exactRoomsApiRouteHandler(request, env, url)
      );
  }
}

async function applyRateLimitResponse(rateResult, response, request) {
  if (!response || rateResult.allowed) {
    return response;
  }

  const headers = {
    ...corsHeaders(request),
    'Content-Type': 'application/json',
    ...rateLimitHeaders(rateResult),
  };

  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      detail: `Rate limit exceeded. Try again in ${rateResult.retryAfter} seconds.`,
    }),
    { status: 429, headers }
  );
}

export async function handleApiRequest(request, env, url, ctx) {
  // Check rate limit before processing
  const rateResult = await checkRateLimit(request, env, url);
  if (!rateResult.allowed) {
    return applyRateLimitResponse(rateResult, null, request);
  }

  const exactRouteHandler = exactApiRouteHandler(request, env, url);
  if (exactRouteHandler) {
    const response = await exactRouteHandler();
    // Add rate limit headers to successful responses
    if (response && rateResult.limit !== undefined) {
      const responseHeaders = new Headers(response.headers);
      const rlHeaders = rateLimitHeaders(rateResult);
      for (const [key, value] of Object.entries(rlHeaders)) {
        responseHeaders.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    }
    return response;
  }

  const dynamicHandlers = [
    handleDynamicFriendRoutes,
    handleDynamicRoomRoutes,
    handleDynamicAdminRoutes,
    handleDynamicChatRoutes,
    handleDynamicSignalRoutes
  ];

  for (const handler of dynamicHandlers) {
    const response = await handler(request, env, url, ctx);
    if (response) {
      return response;
    }
  }

  return jsonResponse({ error: 'Not Found' }, 404, request);
}
