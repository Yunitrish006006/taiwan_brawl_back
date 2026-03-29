function serializeUser(row) {
  return {
    userId: Number(row.user_id ?? row.id),
    name: row.name,
    bio: row.bio ?? '',
    avatarUrl: row.avatar_url ?? null,
    lastActiveAt: row.last_active_at ?? null,
    isOnline: Boolean(Number(row.is_online ?? 0)),
  };
}

function friendPair(userIdA, userIdB) {
  const a = Number(userIdA);
  const b = Number(userIdB);
  return a < b ? [a, b] : [b, a];
}

async function userExists(userId, env) {
  return env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
}

async function pendingRequestBetween(userIdA, userIdB, env) {
  return env.DB.prepare(
    `SELECT id, sender_user_id, receiver_user_id
     FROM friend_requests
     WHERE status = 'pending'
       AND (
         (sender_user_id = ? AND receiver_user_id = ?)
         OR
         (sender_user_id = ? AND receiver_user_id = ?)
       )
     ORDER BY created_at DESC
     LIMIT 1`
  )
    .bind(userIdA, userIdB, userIdB, userIdA)
    .first();
}

async function isBlocked(blockerUserId, blockedUserId, env) {
  const row = await env.DB.prepare(
    `SELECT 1
     FROM user_blocks
     WHERE blocker_user_id = ? AND blocked_user_id = ?
     LIMIT 1`
  )
    .bind(blockerUserId, blockedUserId)
    .first();
  return Boolean(row);
}

async function friendshipExists(userIdA, userIdB, env) {
  const [userOneId, userTwoId] = friendPair(userIdA, userIdB);
  const row = await env.DB.prepare(
    `SELECT 1
     FROM friendships
     WHERE user_one_id = ? AND user_two_id = ?
     LIMIT 1`
  )
    .bind(userOneId, userTwoId)
    .first();
  return Boolean(row);
}

async function resolveRelationshipStatus(currentUserId, targetUserId, env) {
  if (Number(currentUserId) === Number(targetUserId)) {
    return 'self';
  }
  if (await isBlocked(currentUserId, targetUserId, env)) {
    return 'blocked';
  }
  if (await isBlocked(targetUserId, currentUserId, env)) {
    return 'blocked_by_them';
  }
  if (await friendshipExists(currentUserId, targetUserId, env)) {
    return 'friend';
  }

  const pending = await pendingRequestBetween(currentUserId, targetUserId, env);
  if (!pending) {
    return 'none';
  }

  return Number(pending.sender_user_id) === Number(currentUserId)
    ? 'outgoing_pending'
    : 'incoming_pending';
}

async function createFriendship(userIdA, userIdB, env) {
  const [userOneId, userTwoId] = friendPair(userIdA, userIdB);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO friendships (user_one_id, user_two_id)
     VALUES (?, ?)`
  )
    .bind(userOneId, userTwoId)
    .run();
}

function userSelectFields(alias = 'u') {
  return `${alias}.id AS user_id,
    ${alias}.name,
    ${alias}.bio,
    ${alias}.avatar_url,
    ${alias}.last_active_at,
    CASE
      WHEN ${alias}.last_active_at IS NOT NULL
       AND datetime(${alias}.last_active_at) >= datetime('now', '-5 minutes')
      THEN 1
      ELSE 0
    END AS is_online`;
}

export async function getFriendsOverview(userId, env) {
  const friendsRows = await env.DB.prepare(
    `SELECT ${userSelectFields('u')}
     FROM friendships f
     JOIN users u
       ON u.id = CASE
         WHEN f.user_one_id = ? THEN f.user_two_id
         ELSE f.user_one_id
       END
     WHERE f.user_one_id = ? OR f.user_two_id = ?
     ORDER BY is_online DESC, u.name COLLATE NOCASE ASC`
  )
    .bind(userId, userId, userId)
    .all();

  const incomingRows = await env.DB.prepare(
    `SELECT fr.id AS request_id, fr.created_at, ${userSelectFields('u')}
     FROM friend_requests fr
     JOIN users u ON u.id = fr.sender_user_id
     WHERE fr.receiver_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`
  )
    .bind(userId)
    .all();

  const outgoingRows = await env.DB.prepare(
    `SELECT fr.id AS request_id, fr.created_at, ${userSelectFields('u')}
     FROM friend_requests fr
     JOIN users u ON u.id = fr.receiver_user_id
     WHERE fr.sender_user_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`
  )
    .bind(userId)
    .all();

  const blockedRows = await env.DB.prepare(
    `SELECT ${userSelectFields('u')}
     FROM user_blocks ub
     JOIN users u ON u.id = ub.blocked_user_id
     WHERE ub.blocker_user_id = ?
     ORDER BY ub.created_at DESC`
  )
    .bind(userId)
    .all();

  const roomInviteRows = await env.DB.prepare(
    `SELECT ri.id AS invite_id, ri.room_code, ri.created_at, ${userSelectFields('u')}
     FROM room_invites ri
     JOIN users u ON u.id = ri.inviter_user_id
     WHERE ri.invitee_user_id = ? AND ri.status = 'pending'
     ORDER BY ri.created_at DESC`
  )
    .bind(userId)
    .all();

  return {
    friends: friendsRows.results.map(serializeUser),
    incomingRequests: incomingRows.results.map((row) => ({
      id: Number(row.request_id),
      createdAt: row.created_at,
      user: serializeUser(row),
    })),
    outgoingRequests: outgoingRows.results.map((row) => ({
      id: Number(row.request_id),
      createdAt: row.created_at,
      user: serializeUser(row),
    })),
    blockedUsers: blockedRows.results.map(serializeUser),
    roomInvites: roomInviteRows.results.map((row) => ({
      id: Number(row.invite_id),
      roomCode: row.room_code,
      createdAt: row.created_at,
      inviter: serializeUser(row),
    })),
  };
}

export async function searchUserById(currentUserId, rawTargetId, env) {
  const targetUserId = Number(rawTargetId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error('Player ID must be a positive integer');
  }

  const row = await env.DB.prepare(
    `SELECT ${userSelectFields('u')}
     FROM users u
     WHERE u.id = ?`
  )
    .bind(targetUserId)
    .first();

  if (!row) {
    return null;
  }

  return {
    user: serializeUser(row),
    relationshipStatus: await resolveRelationshipStatus(
      currentUserId,
      targetUserId,
      env
    ),
  };
}

export async function sendFriendRequest(currentUserId, rawTargetUserId, env) {
  const targetUserId = Number(rawTargetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error('targetUserId is required');
  }
  if (targetUserId === Number(currentUserId)) {
    throw new Error('You cannot add yourself as a friend');
  }

  const targetUser = await userExists(targetUserId, env);
  if (!targetUser) {
    throw new Error('Player not found');
  }

  const relationshipStatus = await resolveRelationshipStatus(
    currentUserId,
    targetUserId,
    env
  );

  if (relationshipStatus === 'blocked') {
    throw new Error('You have blocked this player');
  }
  if (relationshipStatus === 'blocked_by_them') {
    throw new Error('This player is unavailable');
  }
  if (relationshipStatus === 'friend') {
    throw new Error('You are already friends');
  }
  if (relationshipStatus === 'outgoing_pending') {
    throw new Error('Friend request already sent');
  }
  if (relationshipStatus === 'incoming_pending') {
    const pending = await pendingRequestBetween(currentUserId, targetUserId, env);
    await respondToFriendRequest(currentUserId, pending.id, 'accept', env);
    return { relationshipStatus: 'friend' };
  }

  await env.DB.prepare(
    `INSERT INTO friend_requests (
      sender_user_id,
      receiver_user_id,
      status,
      updated_at
    ) VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`
  )
    .bind(currentUserId, targetUserId)
    .run();

  return { relationshipStatus: 'outgoing_pending' };
}

export async function respondToFriendRequest(
  currentUserId,
  requestId,
  action,
  env
) {
  const request = await env.DB.prepare(
    `SELECT id, sender_user_id, receiver_user_id, status
     FROM friend_requests
     WHERE id = ?`
  )
    .bind(requestId)
    .first();

  if (!request || request.status !== 'pending') {
    throw new Error('Friend request not found');
  }
  if (Number(request.receiver_user_id) !== Number(currentUserId)) {
    throw new Error('You cannot update this friend request');
  }

  const status = action === 'accept' ? 'accepted' : 'rejected';
  await env.DB.prepare(
    `UPDATE friend_requests
     SET status = ?, responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(status, requestId)
    .run();

  if (action === 'accept') {
    await createFriendship(request.sender_user_id, request.receiver_user_id, env);
  }

  return { ok: true, status };
}

export async function cancelFriendRequest(currentUserId, requestId, env) {
  const request = await env.DB.prepare(
    `SELECT id, sender_user_id, status
     FROM friend_requests
     WHERE id = ?`
  )
    .bind(requestId)
    .first();

  if (!request || request.status !== 'pending') {
    throw new Error('Friend request not found');
  }
  if (Number(request.sender_user_id) !== Number(currentUserId)) {
    throw new Error('You cannot cancel this friend request');
  }

  await env.DB.prepare(
    `UPDATE friend_requests
     SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(requestId)
    .run();

  return { ok: true };
}

export async function removeFriend(currentUserId, rawTargetUserId, env) {
  const targetUserId = Number(rawTargetUserId);
  const [userOneId, userTwoId] = friendPair(currentUserId, targetUserId);
  await env.DB.prepare(
    `DELETE FROM friendships
     WHERE user_one_id = ? AND user_two_id = ?`
  )
    .bind(userOneId, userTwoId)
    .run();
  return { ok: true };
}

export async function blockUser(currentUserId, rawTargetUserId, env) {
  const targetUserId = Number(rawTargetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new Error('targetUserId is required');
  }
  if (targetUserId === Number(currentUserId)) {
    throw new Error('You cannot block yourself');
  }
  const targetUser = await userExists(targetUserId, env);
  if (!targetUser) {
    throw new Error('Player not found');
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_blocks (blocker_user_id, blocked_user_id)
     VALUES (?, ?)`
  )
    .bind(currentUserId, targetUserId)
    .run();

  const [userOneId, userTwoId] = friendPair(currentUserId, targetUserId);
  await env.DB.prepare(
    `DELETE FROM friendships
     WHERE user_one_id = ? AND user_two_id = ?`
  )
    .bind(userOneId, userTwoId)
    .run();

  await env.DB.prepare(
    `UPDATE friend_requests
     SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending'
       AND (
         (sender_user_id = ? AND receiver_user_id = ?)
         OR
         (sender_user_id = ? AND receiver_user_id = ?)
       )`
  )
    .bind(currentUserId, targetUserId, targetUserId, currentUserId)
    .run();

  await env.DB.prepare(
    `UPDATE room_invites
     SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending'
       AND (
         (inviter_user_id = ? AND invitee_user_id = ?)
         OR
         (inviter_user_id = ? AND invitee_user_id = ?)
       )`
  )
    .bind(currentUserId, targetUserId, targetUserId, currentUserId)
    .run();

  return { ok: true };
}

export async function unblockUser(currentUserId, rawTargetUserId, env) {
  const targetUserId = Number(rawTargetUserId);
  await env.DB.prepare(
    `DELETE FROM user_blocks
     WHERE blocker_user_id = ? AND blocked_user_id = ?`
  )
    .bind(currentUserId, targetUserId)
    .run();
  return { ok: true };
}

export async function sendRoomInvite(
  currentUserId,
  rawInviteeUserId,
  roomCode,
  env
) {
  const inviteeUserId = Number(rawInviteeUserId);
  if (!Number.isInteger(inviteeUserId) || inviteeUserId <= 0) {
    throw new Error('inviteeUserId is required');
  }
  if (!(await friendshipExists(currentUserId, inviteeUserId, env))) {
    throw new Error('You can only invite friends to battle');
  }
  if (await isBlocked(currentUserId, inviteeUserId, env)) {
    throw new Error('You have blocked this player');
  }
  if (await isBlocked(inviteeUserId, currentUserId, env)) {
    throw new Error('This player is unavailable');
  }

  await env.DB.prepare(
    `UPDATE room_invites
     SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE inviter_user_id = ? AND invitee_user_id = ? AND status = 'pending'`
  )
    .bind(currentUserId, inviteeUserId)
    .run();

  await env.DB.prepare(
    `INSERT INTO room_invites (
      room_code,
      inviter_user_id,
      invitee_user_id,
      status,
      updated_at
    ) VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
  )
    .bind(roomCode, currentUserId, inviteeUserId)
    .run();

  return { ok: true };
}

export async function respondToRoomInvite(currentUserId, inviteId, action, env) {
  const invite = await env.DB.prepare(
    `SELECT id, room_code, invitee_user_id, status
     FROM room_invites
     WHERE id = ?`
  )
    .bind(inviteId)
    .first();

  if (!invite || invite.status !== 'pending') {
    throw new Error('Room invite not found');
  }
  if (Number(invite.invitee_user_id) !== Number(currentUserId)) {
    throw new Error('You cannot update this room invite');
  }

  const status = action === 'accept' ? 'accepted' : 'rejected';
  await env.DB.prepare(
    `UPDATE room_invites
     SET status = ?, responded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(status, inviteId)
    .run();

  return {
    ok: true,
    status,
    roomCode: invite.room_code,
  };
}
