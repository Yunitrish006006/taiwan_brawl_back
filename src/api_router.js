import { handleGoogleLogin, handleLogout, handleMe } from './auth.js';
import {
  exactAdminApiRouteHandler,
  handleDynamicAdminRoutes
} from './admin_api.js';
import { handleDynamicChatRoutes } from './chat_api.js';
import {
  exactFriendsApiRouteHandler,
  handleDynamicFriendRoutes
} from './friends_api.js';
import { exactLlmBotApiRouteHandler } from './llm_bot_api.js';
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
} from './users.js';
import { jsonResponse } from './utils.js';

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
        exactAdminApiRouteHandler(request, env, url) ??
        exactFriendsApiRouteHandler(request, env, url) ??
        exactRoomsApiRouteHandler(request, env, url)
      );
  }
}

export async function handleApiRequest(request, env, url) {
  const exactRouteHandler = exactApiRouteHandler(request, env, url);
  if (exactRouteHandler) {
    return exactRouteHandler();
  }

  const dynamicHandlers = [
    handleDynamicFriendRoutes,
    handleDynamicRoomRoutes,
    handleDynamicAdminRoutes,
    handleDynamicChatRoutes
  ];

  for (const handler of dynamicHandlers) {
    const response = await handler(request, env, url);
    if (response) {
      return response;
    }
  }

  return jsonResponse({ error: 'Not Found' }, 404, request);
}
