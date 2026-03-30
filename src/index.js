import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

import { handleGoogleLogin, handleLogout, handleMe } from './auth.js';
import { searchUsersForAdmin, updateUserRole } from './admin.js';
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
} from './friends_repository.js';
import {
  deleteCard,
  getCardImageResponse,
  getDeckForUser,
  listCards,
  listDecksForUser,
  removeCardImage,
  saveDeckForUser,
  uploadCardImage,
  upsertCard
} from './royale_repository.js';
import { RoyaleRoom } from './royale_room.js';
import { canManageCards, isAdmin } from './permissions.js';
import {
  getUserAvatarImageResponse,
  handleDeleteAvatarImage,
  handleGetCurrentUser,
  handleUpdateCurrentUser,
  handleUploadAvatarImage,
  handleUpdateLocale,
  handleUpdateThemeMode,
  handleUpdateUiPreferences
} from './users.js';
import { corsHeaders, getCurrentUser, jsonResponse } from './utils.js';

async function handleHealth(request) {
  return jsonResponse({ ok: true, message: 'taiwan brawl api alive' }, 200, request);
}

function normalizeSimulationMode(value) {
  const mode = String(value ?? 'server').trim().toLowerCase();
  return mode === 'host' ? 'host' : 'server';
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => {
    const index = Math.floor(Math.random() * alphabet.length);
    return alphabet[index];
  }).join('');
}

function getRoomStub(env, code) {
  return env.ROYALE_ROOM.get(env.ROYALE_ROOM.idFromName(code));
}

async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return null;
  }
  return user;
}

async function requireAdminUser(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return { error: jsonResponse({ error: 'Not logged in' }, 401, request) };
  }
  if (!isAdmin(user)) {
    return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
  }
  return { user };
}

async function requireCardManagerUser(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return { error: jsonResponse({ error: 'Not logged in' }, 401, request) };
  }
  if (!canManageCards(user)) {
    return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
  }
  return { user };
}

async function withBadRequest(request, handler) {
  try {
    return await handler();
  } catch (error) {
    return jsonResponse({ error: error.message || 'Request failed' }, 400, request);
  }
}

async function proxyRoomJson(stub, path, payload, request, user) {
  const upstream = await stub.fetch(
    new Request(`https://royale-room${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  );

  const data = await upstream.json();
  return jsonResponse(data, upstream.status, request);
}

async function handleListCards(request, env) {
  const cards = await listCards(env);
  return jsonResponse({ ok: true, cards }, 200, request);
}

async function handleAdminSearchUsers(request, env, url) {
  const { user, error } = await requireAdminUser(request, env);
  if (error) {
    return error;
  }

  const users = await searchUsersForAdmin(url.searchParams.get('query'), env);
  return jsonResponse({ ok: true, users, viewerRole: user.role }, 200, request);
}

async function handleAdminUpdateUserRole(request, env, targetUserId) {
  return withBadRequest(request, async () => {
    const { user, error } = await requireAdminUser(request, env);
    if (error) {
      return error;
    }

    const body = await request.json().catch(() => null);
    const updatedUser = await updateUserRole(user.id, targetUserId, body?.role, env);
    return jsonResponse({ ok: true, user: updatedUser }, 200, request);
  });
}

async function handleManageCard(request, env) {
  return withBadRequest(request, async () => {
    const { error } = await requireCardManagerUser(request, env);
    if (error) {
      return error;
    }

    const body = await request.json().catch(() => null);
    const card = await upsertCard(env, body);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCard(request, env, cardId) {
  return withBadRequest(request, async () => {
    const { error } = await requireCardManagerUser(request, env);
    if (error) {
      return error;
    }

    await deleteCard(env, cardId);
    return jsonResponse({ ok: true }, 200, request);
  });
}

async function handleUploadManagedCardImage(request, env, cardId) {
  return withBadRequest(request, async () => {
    const { error } = await requireCardManagerUser(request, env);
    if (error) {
      return error;
    }

    const body = await request.json().catch(() => null);
    const card = await uploadCardImage(env, cardId, body);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCardImage(request, env, cardId) {
  return withBadRequest(request, async () => {
    const { error } = await requireCardManagerUser(request, env);
    if (error) {
      return error;
    }

    const card = await removeCardImage(env, cardId);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleListDecks(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const decks = await listDecksForUser(user.id, env);
  return jsonResponse({ ok: true, decks }, 200, request);
}

async function handleSaveDeck(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ error: 'Invalid body' }, 400, request);
  }

  const deck = await saveDeckForUser(user.id, body, env);
  return jsonResponse({ ok: true, deck }, 200, request);
}

async function resolveOwnedDeck(request, env, user, body) {
  const deckId = Number(body?.deckId);
  if (!Number.isInteger(deckId) || deckId <= 0) {
    return { error: jsonResponse({ error: 'deckId is required' }, 400, request) };
  }

  const deck = await getDeckForUser(user.id, deckId, env);
  if (!deck) {
    return { error: jsonResponse({ error: 'Deck not found' }, 404, request) };
  }

  return { deck };
}

async function handleCreateRoom(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const { deck, error } = await resolveOwnedDeck(request, env, user, body);
  if (error) {
    return error;
  }
  const vsBot = Boolean(body?.vsBot);
  const simulationMode = normalizeSimulationMode(body?.simulationMode);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomRoomCode();
    const stub = getRoomStub(env, code);
    const upstream = await stub.fetch(
      new Request('https://royale-room/internal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          user: { id: user.id, name: user.name },
          deck,
          vsBot,
          botDeck: deck,
          simulationMode
        })
      })
    );

    if (upstream.status === 409) {
      continue;
    }

    const data = await upstream.json();
    return jsonResponse(data, upstream.status, request);
  }

  return jsonResponse({ error: 'Unable to allocate room code' }, 500, request);
}

async function handleJoinRoom(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const { deck, error } = await resolveOwnedDeck(request, env, user, body);
  if (error) {
    return error;
  }

  const stub = getRoomStub(env, code);
  return proxyRoomJson(
    stub,
    '/internal/join',
    {
      user: { id: user.id, name: user.name },
      deck
    },
    request,
    user
  );
}

async function handleReadyRoom(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const stub = getRoomStub(env, code);
  return proxyRoomJson(
    stub,
    '/internal/ready',
    { userId: user.id },
    request,
    user
  );
}

async function handleRematchRoom(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const stub = getRoomStub(env, code);
  return proxyRoomJson(
    stub,
    '/internal/rematch',
    { userId: user.id },
    request,
    user
  );
}

async function handleHostFinishRoom(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await request.json().catch(() => null);
  const stub = getRoomStub(env, code);
  return proxyRoomJson(
    stub,
    '/internal/host-finish',
    {
      userId: user.id,
      winnerSide: body?.winnerSide ?? null,
      reason: body?.reason ?? 'time_up',
      leftTowerHp: body?.leftTowerHp,
      rightTowerHp: body?.rightTowerHp
    },
    request,
    user
  );
}

async function handleRoomState(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const stub = getRoomStub(env, code);
  const upstream = await stub.fetch(
    new Request('https://royale-room/internal/state', {
      method: 'GET',
      headers: { 'x-user-id': String(user.id) }
    })
  );

  const data = await upstream.json();
  return jsonResponse(data, upstream.status, request);
}

async function handleFriendsOverview(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const overview = await getFriendsOverview(user.id, env);
  return jsonResponse({ ok: true, ...overview }, 200, request);
}

async function handleFriendSearch(request, env, url) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const results = await searchUsersByName(
      user.id,
      url.searchParams.get('query'),
      env
    );
    return jsonResponse({ ok: true, results }, 200, request);
  });
}

async function handleSendFriendRequest(request, env) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const body = await request.json().catch(() => null);
    const result = await sendFriendRequest(user.id, body?.targetUserId, env);
    return jsonResponse({ ok: true, ...result }, 200, request);
  });
}

async function handleFriendRequestAction(request, env, requestId, action) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    if (action === 'cancel') {
      const result = await cancelFriendRequest(user.id, requestId, env);
      return jsonResponse(result, 200, request);
    }

    const result = await respondToFriendRequest(user.id, requestId, action, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleRemoveFriend(request, env, targetUserId) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const result = await removeFriend(user.id, targetUserId, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleBlockUser(request, env) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const body = await request.json().catch(() => null);
    const result = await blockUser(user.id, body?.targetUserId, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleUnblockUser(request, env, targetUserId) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const result = await unblockUser(user.id, targetUserId, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleSendRoomInvite(request, env, roomCode) {
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const body = await request.json().catch(() => null);
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
  return withBadRequest(request, async () => {
    const user = await requireUser(request, env);
    if (!user) {
      return jsonResponse({ error: 'Not logged in' }, 401, request);
    }

    const result = await respondToRoomInvite(user.id, inviteId, action, env);
    return jsonResponse(result, 200, request);
  });
}

async function handleRoomWebSocket(request, env, code) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ error: 'Expected WebSocket upgrade' }, 426, request);
  }

  const stub = getRoomStub(env, code);
  const headers = new Headers(request.headers);
  headers.set('x-user-id', String(user.id));
  headers.set('x-user-name', user.name);

  return stub.fetch(
    new Request('https://royale-room/internal/ws', {
      method: 'GET',
      headers
    })
  );
}

function matchRoomRoute(pathname) {
  const match = pathname.match(
    /^\/api\/rooms\/([A-Z0-9]{6})\/(join|ready|rematch|state|ws|invite|host-finish)$/
  );
  if (!match) {
    return null;
  }

  return {
    code: match[1],
    action: match[2]
  };
}

function matchFriendRequestRoute(pathname) {
  const match = pathname.match(
    /^\/api\/friends\/requests\/(\d+)\/(accept|reject|cancel)$/
  );
  if (!match) {
    return null;
  }
  return {
    requestId: Number(match[1]),
    action: match[2]
  };
}

function matchFriendRoute(pathname) {
  const match = pathname.match(/^\/api\/friends\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function matchBlockedUserRoute(pathname) {
  const match = pathname.match(/^\/api\/friends\/block\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function matchRoomInviteRoute(pathname) {
  const match = pathname.match(/^\/api\/room-invites\/(\d+)\/(accept|reject)$/);
  if (!match) {
    return null;
  }
  return {
    inviteId: Number(match[1]),
    action: match[2]
  };
}

function matchAdminUserRoleRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/users\/(\d+)\/role$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function matchManagedCardRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/cards\/([a-zA-Z0-9_]+)$/);
  if (!match) {
    return null;
  }
  return match[1];
}

function matchManagedCardImageRoute(pathname) {
  const match = pathname.match(/^\/api\/admin\/cards\/([a-zA-Z0-9_]+)\/image$/);
  if (!match) {
    return null;
  }
  return match[1];
}

function matchCardImagePath(pathname) {
  const match = pathname.match(/^\/card-images\/([a-zA-Z0-9_]+)$/);
  if (!match) {
    return null;
  }
  return match[1];
}

function matchUserAvatarPath(pathname) {
  const match = pathname.match(/^\/user-avatars\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

async function handleApiRequest(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return handleHealth(request);
  }
  if (request.method === 'GET' && url.pathname === '/api/me') {
    return handleMe(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/users/me') {
    return handleGetCurrentUser(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/me') {
    return handleUpdateCurrentUser(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/users/me/avatar-image') {
    return handleUploadAvatarImage(request, env);
  }
  if (
    request.method === 'DELETE' &&
    url.pathname === '/api/users/me/avatar-image'
  ) {
    return handleDeleteAvatarImage(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/theme-mode') {
    return handleUpdateThemeMode(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/ui-preferences') {
    return handleUpdateUiPreferences(request, env);
  }
  if (request.method === 'PUT' && url.pathname === '/api/users/locale') {
    return handleUpdateLocale(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    return handleLogout(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/google-login') {
    return handleGoogleLogin(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/cards') {
    return handleListCards(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    return handleAdminSearchUsers(request, env, url);
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/cards') {
    return handleManageCard(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/decks') {
    return handleListDecks(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/decks') {
    return handleSaveDeck(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    return handleCreateRoom(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/friends/overview') {
    return handleFriendsOverview(request, env);
  }
  if (request.method === 'GET' && url.pathname === '/api/friends/search') {
    return handleFriendSearch(request, env, url);
  }
  if (request.method === 'POST' && url.pathname === '/api/friends/requests') {
    return handleSendFriendRequest(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/api/friends/block') {
    return handleBlockUser(request, env);
  }

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

  const roomRoute = matchRoomRoute(url.pathname);
  if (roomRoute) {
    if (request.method === 'POST' && roomRoute.action === 'join') {
      return handleJoinRoom(request, env, roomRoute.code);
    }
    if (request.method === 'POST' && roomRoute.action === 'ready') {
      return handleReadyRoom(request, env, roomRoute.code);
    }
    if (request.method === 'POST' && roomRoute.action === 'rematch') {
      return handleRematchRoom(request, env, roomRoute.code);
    }
    if (request.method === 'POST' && roomRoute.action === 'host-finish') {
      return handleHostFinishRoom(request, env, roomRoute.code);
    }
    if (request.method === 'GET' && roomRoute.action === 'state') {
      return handleRoomState(request, env, roomRoute.code);
    }
    if (request.method === 'GET' && roomRoute.action === 'ws') {
      return handleRoomWebSocket(request, env, roomRoute.code);
    }
    if (request.method === 'POST' && roomRoute.action === 'invite') {
      return handleSendRoomInvite(request, env, roomRoute.code);
    }
  }

  const adminUserRoleTarget = matchAdminUserRoleRoute(url.pathname);
  if (adminUserRoleTarget && request.method === 'PUT') {
    return handleAdminUpdateUserRole(request, env, adminUserRoleTarget);
  }

  const managedCardImageId = matchManagedCardImageRoute(url.pathname);
  if (managedCardImageId && request.method === 'POST') {
    return handleUploadManagedCardImage(request, env, managedCardImageId);
  }
  if (managedCardImageId && request.method === 'DELETE') {
    return handleDeleteManagedCardImage(request, env, managedCardImageId);
  }

  const managedCardId = matchManagedCardRoute(url.pathname);
  if (managedCardId && request.method === 'DELETE') {
    return handleDeleteManagedCard(request, env, managedCardId);
  }

  return jsonResponse({ error: 'Not Found' }, 404, request);
}

export { RoyaleRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const cardImageId = matchCardImagePath(url.pathname);
    if (cardImageId && request.method === 'GET') {
      const response = await getCardImageResponse(env, cardImageId);
      if (response) {
        return response;
      }
      return jsonResponse({ error: 'Not Found' }, 404, request);
    }

    const userAvatarId = matchUserAvatarPath(url.pathname);
    if (userAvatarId && request.method === 'GET') {
      const response = await getUserAvatarImageResponse(env, userAvatarId);
      if (response) {
        return response;
      }
      return jsonResponse({ error: 'Not Found' }, 404, request);
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApiRequest(request, env, url);
      } catch (error) {
        return jsonResponse(
          { error: 'Internal server error', detail: error.message },
          500,
          request
        );
      }
    }

    try {
      let assetRequest = request;
      if (url.pathname === '/') {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = '/index.html';
        assetRequest = new Request(indexUrl, request);
      }

      return await getAssetFromKV(
        { request: assetRequest },
        {
          ASSET_NAMESPACE: env.STATIC_ASSETS
        }
      );
    } catch (_) {
      try {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = '/index.html';
        const indexRequest = new Request(indexUrl, request);
        return await getAssetFromKV(
          { request: indexRequest },
          {
            ASSET_NAMESPACE: env.STATIC_ASSETS
          }
        );
      } catch (error) {
        return jsonResponse({ error: 'Not Found', detail: error.message }, 404, request);
      }
    }
  }
};
