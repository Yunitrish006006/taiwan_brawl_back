import { requireUser, readJsonBody } from './request_helpers.js';
import {
  buildPublicPushConfig,
  registerPushDevice,
  unregisterPushDevice,
  validatePushRequestBody,
} from './push_notifications.js';
import { jsonResponse } from './utils.js';

async function handleNotificationsConfig(request, env) {
  return jsonResponse(
    {
      ok: true,
      config: buildPublicPushConfig(env),
    },
    200,
    request
  );
}

async function handleRegisterPushToken(request, env) {
  const user = await requireUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'Not logged in' }, 401, request);
  }

  const body = await readJsonBody(request);
  const validation = validatePushRequestBody(request, body);
  if (validation.error) {
    return validation.error;
  }

  await registerPushDevice(user.id, body, env);
  return jsonResponse({ ok: true }, 200, request);
}

async function handleUnregisterPushToken(request, env) {
  const body = await readJsonBody(request);
  const validation = validatePushRequestBody(request, body, {
    requireInstallationId: true,
    requirePlatform: true,
    requireRegistrationFields: false,
  });
  if (validation.error) {
    return validation.error;
  }

  await unregisterPushDevice(body, env);
  return jsonResponse({ ok: true }, 200, request);
}

export function exactNotificationsApiRouteHandler(request, env, url) {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/notifications/config':
      return () => handleNotificationsConfig(request, env);
    case 'POST /api/notifications/register':
      return () => handleRegisterPushToken(request, env);
    case 'POST /api/notifications/unregister':
      return () => handleUnregisterPushToken(request, env);
    default:
      return null;
  }
}
