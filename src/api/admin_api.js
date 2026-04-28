import { searchUsersForAdmin, updateUserRole } from '../features/admin.js';
import { canManageCards, isAdmin } from '../core/permissions.js';
import {
  deleteCard,
  removeCardImage,
  uploadCardImage,
  uploadCardCharacterAsset,
  removeCardCharacterAsset,
  uploadCardCharacterImage,
  removeCardCharacterImage,
  uploadCardBgImage,
  removeCardBgImage,
  upsertCard
} from '../royale/royale_repository.js';
import {
  matchAdminUserRoleRoute,
  matchManagedCardCharacterAssetRoute,
  matchManagedCardImageRoute,
  matchManagedCardCharacterImageDirectionRoute,
  matchManagedCardCharacterImageRoute,
  matchManagedCardBgImageRoute,
  matchManagedCardRoute
} from '../core/route_patterns.js';
import {
  readJsonBody,
  withAuthorizedBadRequest
} from '../core/request_helpers.js';
import { jsonResponse } from '../core/utils.js';

function withAdminBadRequest(request, env, handler) {
  return withAuthorizedBadRequest(request, env, isAdmin, handler);
}

function withCardManagerBadRequest(request, env, handler) {
  return withAuthorizedBadRequest(request, env, canManageCards, handler);
}

async function handleAdminSearchUsers(request, env, url) {
  return withAdminBadRequest(request, env, async (user) => {
    const users = await searchUsersForAdmin(url.searchParams.get('query'), env);
    return jsonResponse({ ok: true, users, viewerRole: user.role }, 200, request);
  });
}

async function handleAdminUpdateUserRole(request, env, targetUserId) {
  return withAdminBadRequest(request, env, async (user) => {
    const body = await readJsonBody(request);
    const updatedUser = await updateUserRole(user.id, targetUserId, body?.role, env);
    return jsonResponse({ ok: true, user: updatedUser }, 200, request);
  });
}

async function handleManageCard(request, env) {
  return withCardManagerBadRequest(request, env, async () => {
    const body = await readJsonBody(request);
    const card = await upsertCard(env, body);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCard(request, env, cardId) {
  return withCardManagerBadRequest(request, env, async () => {
    await deleteCard(env, cardId);
    return jsonResponse({ ok: true }, 200, request);
  });
}

async function handleUploadManagedCardImage(request, env, cardId) {
  return withCardManagerBadRequest(request, env, async () => {
    const body = await readJsonBody(request);
    const card = await uploadCardImage(env, cardId, body);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCardImage(request, env, cardId) {
  return withCardManagerBadRequest(request, env, async () => {
    const card = await removeCardImage(env, cardId);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleUploadManagedCardCharacterImage(
  request,
  env,
  cardId,
  direction = 'front'
) {
  return withCardManagerBadRequest(request, env, async () => {
    const body = await readJsonBody(request);
    const card = await uploadCardCharacterImage(env, cardId, body, direction);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCardCharacterImage(
  request,
  env,
  cardId,
  direction = 'front'
) {
  return withCardManagerBadRequest(request, env, async () => {
    const card = await removeCardCharacterImage(env, cardId, direction);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleUploadManagedCardCharacterAsset(
  request,
  env,
  cardId,
  assetId
) {
  return withCardManagerBadRequest(request, env, async () => {
    const body = await readJsonBody(request);
    const card = await uploadCardCharacterAsset(env, cardId, assetId, body);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCardCharacterAsset(
  request,
  env,
  cardId,
  assetId
) {
  return withCardManagerBadRequest(request, env, async () => {
    const card = await removeCardCharacterAsset(env, cardId, assetId);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleUploadManagedCardBgImage(request, env, cardId) {
  return withCardManagerBadRequest(request, env, async () => {
    const body = await readJsonBody(request);
    const card = await uploadCardBgImage(env, cardId, body);
    return jsonResponse({ ok: true, card }, 200, request);
  });
}

async function handleDeleteManagedCardBgImage(request, env, cardId) {
  return withCardManagerBadRequest(request, env, async () => {
    const card = await removeCardBgImage(env, cardId);
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

  const managedCardCharacterAsset = matchManagedCardCharacterAssetRoute(
    url.pathname
  );
  if (managedCardCharacterAsset && request.method === 'POST') {
    return handleUploadManagedCardCharacterAsset(
      request,
      env,
      managedCardCharacterAsset.cardId,
      managedCardCharacterAsset.assetId
    );
  }
  if (managedCardCharacterAsset && request.method === 'DELETE') {
    return handleDeleteManagedCardCharacterAsset(
      request,
      env,
      managedCardCharacterAsset.cardId,
      managedCardCharacterAsset.assetId
    );
  }

  const managedCardDirectionalCharImage =
    matchManagedCardCharacterImageDirectionRoute(url.pathname);
  if (managedCardDirectionalCharImage && request.method === 'POST') {
    return handleUploadManagedCardCharacterImage(
      request,
      env,
      managedCardDirectionalCharImage.cardId,
      managedCardDirectionalCharImage.direction
    );
  }
  if (managedCardDirectionalCharImage && request.method === 'DELETE') {
    return handleDeleteManagedCardCharacterImage(
      request,
      env,
      managedCardDirectionalCharImage.cardId,
      managedCardDirectionalCharImage.direction
    );
  }

  const managedCardCharImageId = matchManagedCardCharacterImageRoute(url.pathname);
  if (managedCardCharImageId && request.method === 'POST') {
    return handleUploadManagedCardCharacterImage(request, env, managedCardCharImageId);
  }
  if (managedCardCharImageId && request.method === 'DELETE') {
    return handleDeleteManagedCardCharacterImage(request, env, managedCardCharImageId);
  }

  const managedCardBgImageId = matchManagedCardBgImageRoute(url.pathname);
  if (managedCardBgImageId && request.method === 'POST') {
    return handleUploadManagedCardBgImage(request, env, managedCardBgImageId);
  }
  if (managedCardBgImageId && request.method === 'DELETE') {
    return handleDeleteManagedCardBgImage(request, env, managedCardBgImageId);
  }

  const managedCardId = matchManagedCardRoute(url.pathname);
  if (managedCardId && request.method === 'DELETE') {
    return handleDeleteManagedCard(request, env, managedCardId);
  }

  return null;
}
