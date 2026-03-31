import { searchUsersForAdmin, updateUserRole } from './admin.js';
import { canManageCards, isAdmin } from './permissions.js';
import {
  deleteCard,
  removeCardImage,
  uploadCardImage,
  upsertCard
} from './royale_repository.js';
import {
  matchAdminUserRoleRoute,
  matchManagedCardImageRoute,
  matchManagedCardRoute
} from './route_patterns.js';
import {
  requireAuthorizedUser,
  withBadRequest
} from './request_helpers.js';
import { jsonResponse } from './utils.js';

async function requireAdminUser(request, env) {
  return requireAuthorizedUser(request, env, isAdmin);
}

async function requireCardManagerUser(request, env) {
  return requireAuthorizedUser(request, env, canManageCards);
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

export function exactAdminApiRouteHandler(request, env, url) {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/admin/users':
      return () => handleAdminSearchUsers(request, env, url);
    case 'POST /api/admin/cards':
      return () => handleManageCard(request, env);
    default:
      return null;
  }
}

export async function handleDynamicAdminRoutes(request, env, url) {
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

  return null;
}
