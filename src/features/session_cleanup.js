/**
 * Session cleanup functionality
 * Scheduled task to remove expired sessions from the database
 */

const SESSION_CLEANUP_BATCH_SIZE = 1000;

/**
 * Clean up expired sessions from the database
 * Returns the number of deleted sessions
 */
export async function cleanupExpiredSessions(env) {
  let totalDeleted = 0;
  let deleted = 0;

  do {
    const result = await env.DB.prepare(
      `DELETE FROM sessions WHERE expires_at < datetime('now', '-1 day') LIMIT ?`
    )
      .bind(SESSION_CLEANUP_BATCH_SIZE)
      .run();

    deleted = result.meta?.changes ?? 0;
    totalDeleted += deleted;

    // If we deleted fewer than batch size, we're done
    if (deleted < SESSION_CLEANUP_BATCH_SIZE) {
      break;
    }

    // Small delay to avoid overwhelming the DB
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (deleted > 0);

  return totalDeleted;
}

/**
 * Count current sessions (for monitoring)
 */
export async function countActiveSessions(env) {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sessions WHERE expires_at > datetime('now')`
  ).first();
  return Number(result?.count || 0);
}

/**
 * Count expired sessions (for monitoring)
 */
export async function countExpiredSessions(env) {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sessions WHERE expires_at <= datetime('now')`
  ).first();
  return Number(result?.count || 0);
}
