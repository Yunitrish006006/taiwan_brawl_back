export const splitMode = env => env.DATABASE_MODE === 'split';
export class AccountUnavailableError extends Error {}
export function socialDatabase(env) {
  if (!splitMode(env)) return env.DB;
  if (!env.SOCIAL_DB) throw new Error('Social database unavailable');
  return env.SOCIAL_DB;
}
export function gameDatabase(env) {
  if (!splitMode(env)) return env.DB;
  if (!env.GAME_DB) throw new Error('Game database unavailable');
  return env.GAME_DB;
}
export async function requireActiveAccounts(env, ids) {
  if (!splitMode(env)) return;
  for (const id of new Set(ids)) {
    const row = await env.DB.prepare('SELECT lifecycle_status FROM users WHERE id=?').bind(id).first();
    if (row?.lifecycle_status !== 'active') throw new AccountUnavailableError('Player unavailable');
  }
}
export async function socialPairAllowed(env, a, b) {
  try { await requireActiveAccounts(env, [a,b]); }
  catch(error) { if(error instanceof AccountUnavailableError) return false; throw error; }
  const db=socialDatabase(env), one=Math.min(a,b), two=Math.max(a,b);
  return Boolean(await db.prepare(`SELECT 1 FROM friendships WHERE user_one_id=? AND user_two_id=?
    AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?))
    AND NOT EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (?,?))`)
    .bind(one,two,a,b,b,a,a,b).first());
}
