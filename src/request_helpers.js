import { getCurrentUser, jsonResponse } from './utils.js';

export async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return null;
  }
  return user;
}

export async function requireAuthorizedUser(request, env, isAllowed) {
  const user = await requireUser(request, env);
  if (!user) {
    return { error: jsonResponse({ error: 'Not logged in' }, 401, request) };
  }
  if (!isAllowed(user)) {
    return { error: jsonResponse({ error: 'Forbidden' }, 403, request) };
  }
  return { user };
}

export async function withAuthenticatedUser(request, env, handler) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }
  return handler(user);
}

export async function withBadRequest(request, handler) {
  try {
    return await handler();
  } catch (error) {
    return jsonResponse({ error: error.message || 'Request failed' }, 400, request);
  }
}

export async function withAuthenticatedBadRequest(request, env, handler) {
  return withBadRequest(request, async () =>
    withAuthenticatedUser(request, env, handler)
  );
}
