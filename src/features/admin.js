import { assignableRoles, normalizeRole } from '../core/permissions.js';

function mapManageUser(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: normalizeRole(row.role),
    lastActiveAt: row.last_active_at ?? null
  };
}

export async function searchUsersForAdmin(query, env) {
  const search = String(query ?? '').trim();
  const like = `%${search}%`;
  const maybeId = Number(search);

  const rows = await env.DB.prepare(
    `SELECT id, name, email, role, last_active_at
     FROM users
     WHERE ? = ''
        OR name LIKE ?
        OR email LIKE ?
        OR id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 50`
  )
    .bind(search, like, like, Number.isInteger(maybeId) ? maybeId : -1)
    .all();

  return rows.results.map(mapManageUser);
}

export async function updateUserRole(adminUserId, targetUserId, role, env) {
  const normalizedRole = normalizeRole(role);
  if (!assignableRoles.includes(normalizedRole)) {
    throw new Error('Invalid role');
  }

  const targetId = Number(targetUserId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error('Invalid target user');
  }
  if (adminUserId === targetId) {
    throw new Error('You cannot change your own role');
  }

  const existing = await env.DB.prepare(
    'SELECT id, name, email, role, last_active_at FROM users WHERE id = ?'
  )
    .bind(targetId)
    .first();
  if (!existing) {
    throw new Error('User not found');
  }

  await env.DB.prepare(
    'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind(normalizedRole, targetId)
    .run();

  const updated = await env.DB.prepare(
    'SELECT id, name, email, role, last_active_at FROM users WHERE id = ?'
  )
    .bind(targetId)
    .first();

  return mapManageUser(updated);
}
