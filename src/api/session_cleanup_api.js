/**
 * Session cleanup API endpoint
 * Protected endpoint for scheduled task triggers
 */

import { jsonResponse } from '../core/utils.js';
import {
  cleanupExpiredSessions,
  countActiveSessions,
  countExpiredSessions,
} from '../features/session_cleanup.js';

// Admin API key for cleanup endpoint (stored in secrets)
const CLEANUP_API_KEY_HEADER = 'X-Cleanup-Key';

function isAuthorizedCleanup(request, env) {
  const key = request.headers.get(CLEANUP_API_KEY_HEADER);
  return key === env.CLEANUP_SECRET_KEY;
}

/**
 * GET /api/admin/sessions/stats - Get session statistics
 */
export async function handleGetSessionStats(request, env) {
  // Require authorization
  if (!isAuthorizedCleanup(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request);
  }

  const active = await countActiveSessions(env);
  const expired = await countExpiredSessions(env);
  const total = active + expired;

  return jsonResponse({
    active,
    expired,
    total,
    expiredPercent: total > 0 ? ((expired / total) * 100).toFixed(2) : '0.00',
  }, 200, request);
}

/**
 * POST /api/admin/sessions/cleanup - Trigger session cleanup
 */
export async function handleCleanupSessions(request, env) {
  // Require authorization
  if (!isAuthorizedCleanup(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request);
  }

  const beforeExpired = await countExpiredSessions(env);
  const deleted = await cleanupExpiredSessions(env);
  const afterExpired = await countExpiredSessions(env);

  return jsonResponse({
    deleted,
    beforeExpired,
    afterExpired,
    success: true,
  }, 200, request);
}
