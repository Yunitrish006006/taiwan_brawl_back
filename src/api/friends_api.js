import {
  blockUser,
  cancelFriendRequest,
  getFriendsOverview,
  removeFriend,
  respondToFriendRequest,
  respondToRoomInvite,
  searchUsersByName,
  sendFriendRequest,
  sendRoomInvite,
  unblockUser
} from '../features/friends_repository.js';
import {
  matchBlockedUserRoute,
  matchFriendRequestRoute,
  matchFriendRoute,
  matchRoomInviteRoute
} from '../core/route_patterns.js';
import {
  requireUser,
  readJsonBody,
  withAuthenticatedBadRequest
} from '../core/request_helpers.js';
import { jsonResponse } from '../core/utils.js';

async function handleFriendsOverview(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const overview = await getFriendsOverview(user.id, env);
  return jsonResponse({ ok: true, ...overview }, 200, request);
}

async function handleFriendSearch(request, env, url) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const results = await searchUsersByName(
      user.id,
      url.searchParams.get('query'),
      env
    );
    return jsonResponse({ ok: true, results }, 200, request);
  });
}

async function handleSendFriendRequest(request, env) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const body = await readJsonBody(request);
    const result = await sendFriendRequest(user.id, body?.targetUserId, env);
    return jsonResponse({ ok: true, ...result }, 200, request);
  });
}

async function handleFriendRequestAction(request, env, requestId, action) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    if (action === 'cancel') {
      const result = await cancelFriendRequest(user.id, requestId, env);
      return jsonResponse(result, 200, request);
    }

    const result = await respondToFriendRequest(user.id, requestId, action, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleRemoveFriend(request, env, targetUserId) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const result = await removeFriend(user.id, targetUserId, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleBlockUser(request, env) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const body = await readJsonBody(request);
    const result = await blockUser(user.id, body?.targetUserId, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleUnblockUser(request, env, targetUserId) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const result = await unblockUser(user.id, targetUserId, env);
    return jsonResponse(result, 200, request);
  });
}

export async function handleSendRoomInvite(request, env, roomCode) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const body = await readJsonBody(request);
    const result = await sendRoomInvite(
      user.id,
      body?.inviteeUserId,
      roomCode,
      env
    );
    return jsonResponse(result, 200, request);
  });
}

async function handleRoomInviteAction(request, env, inviteId, action) {
  return withAuthenticatedBadRequest(request, env, async (user) => {
    const result = await respondToRoomInvite(user.id, inviteId, action, env);
    return jsonResponse(result, 200, request);
  });
}

export function exactFriendsApiRouteHandler(request, env, url) {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/friends/overview':
      return () => handleFriendsOverview(request, env);
    case 'GET /api/friends/search':
      return () => handleFriendSearch(request, env, url);
    case 'POST /api/friends/requests':
      return () => handleSendFriendRequest(request, env);
    case 'POST /api/friends/block':
      return () => handleBlockUser(request, env);
    default:
      return null;
  }
}

export async function handleDynamicFriendRoutes(request, env, url) {
  const friendRequestRoute = matchFriendRequestRoute(url.pathname);
  if (friendRequestRoute && request.method === 'POST') {
    return handleFriendRequestAction(
      request,
      env,
      friendRequestRoute.requestId,
      friendRequestRoute.action
    );
  }

  const friendUserId = matchFriendRoute(url.pathname);
  if (friendUserId && request.method === 'DELETE') {
    return handleRemoveFriend(request, env, friendUserId);
  }

  const blockedUserId = matchBlockedUserRoute(url.pathname);
  if (blockedUserId && request.method === 'DELETE') {
    return handleUnblockUser(request, env, blockedUserId);
  }

  const roomInviteRoute = matchRoomInviteRoute(url.pathname);
  if (roomInviteRoute && request.method === 'POST') {
    return handleRoomInviteAction(
      request,
      env,
      roomInviteRoute.inviteId,
      roomInviteRoute.action
    );
  }

  return null;
}
