import { matchRoomRoute } from '../core/route_patterns.js';
import { handleSendRoomInvite } from './friends_api.js';
import { exactMiniRoyaleDataApiRouteHandler } from './mini_royale_data_api.js';
import {
  exactMiniRoyaleRoomApiRouteHandler,
  handleDynamicMiniRoyaleRoomRoutes
} from './mini_royale_room_api.js';
import { mapMiniRoyaleApiPath, resolveGameApiPath } from './game_api_paths.js';

/// Compatibility router retained while API router consumers migrate to game-owned handlers.
export function exactRoomsApiRouteHandler(request, env, url) {
  return (
    exactMiniRoyaleDataApiRouteHandler(request, env, url) ??
    exactMiniRoyaleRoomApiRouteHandler(request, env, url)
  );
}

export async function handleDynamicRoomRoutes(request, env, url) {
  const gameRoute = await handleDynamicMiniRoyaleRoomRoutes(request, env, url);
  if (gameRoute) return gameRoute;

  const versionedGameRoute = resolveGameApiPath(url.pathname);
  const path = versionedGameRoute?.pathname ?? url.pathname;
  const roomRoute = matchRoomRoute(path);
  if (roomRoute?.action === 'invite' && request.method === 'POST') {
    const gameId = versionedGameRoute?.gameId ?? (
      path === url.pathname ? 'game.mini-royale' : null
    );
    if (!gameId) return null;
    return handleSendRoomInvite(
      request,
      env,
      roomRoute.code,
      gameId,
    );
  }
  return null;
}
