// CD-01 storage primitives only. HTTP authentication/date validation is CD-02.
// Callers must supply validated UTC ISO timestamps and account authorization.
export function acceptCoupleStatements(db, { requestId, actorId, relationshipId,
  operationId, requestHash, now }) {
  const p = (sql, ...args) => db.prepare(sql).bind(...args);
  return [
    p(`INSERT INTO couple_relationships(id,user_a_id,user_b_id,started_on,status,created_at,updated_at)
       SELECT ?,q.user_a_id,q.user_b_id,q.proposed_started_on,'active',?,?
       FROM couple_requests q WHERE q.id=? AND q.recipient_id=? AND q.status='pending'
       AND q.expires_at > ?
       AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_one_id=q.user_a_id AND f.user_two_id=q.user_b_id)
       AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
         (b.blocker_user_id=q.user_a_id AND b.blocked_user_id=q.user_b_id) OR
         (b.blocker_user_id=q.user_b_id AND b.blocked_user_id=q.user_a_id))
       AND NOT EXISTS(SELECT 1 FROM account_tombstones t WHERE t.user_id IN(q.user_a_id,q.user_b_id))`,
      relationshipId, now, now, requestId, actorId, now),
    p(`INSERT INTO couple_active_members SELECT user_a_id,id FROM couple_relationships WHERE id=?`, relationshipId),
    p(`INSERT INTO couple_active_members SELECT user_b_id,id FROM couple_relationships WHERE id=?`, relationshipId),
    p(`UPDATE couple_requests SET status='accepted',responded_at=?,relationship_id=?
       WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM couple_relationships WHERE id=?)`,
      now, relationshipId, requestId, relationshipId),
    p(`INSERT INTO couple_write_guards VALUES(?,CASE WHEN
       EXISTS(SELECT 1 FROM couple_requests WHERE id=? AND status='accepted' AND relationship_id=?)
       AND (SELECT count(*) FROM couple_active_members WHERE relationship_id=?)=2 THEN 1 ELSE 0 END)`,
      operationId, requestId, relationshipId, relationshipId),
    p(`UPDATE couple_requests SET status='invalidated',responded_at=? WHERE status='pending'
       AND (requester_id IN(SELECT user_id FROM couple_active_members WHERE relationship_id=?)
       OR recipient_id IN(SELECT user_id FROM couple_active_members WHERE relationship_id=?))`,
      now, relationshipId, relationshipId),
    p(`INSERT INTO couple_audit VALUES(?,?,?,'accepted',?)`, `${actorId}:${operationId}`, relationshipId, actorId, now),
    p(`INSERT INTO couple_operations VALUES(?,?,?,?,200,?)`, actorId, operationId, requestHash,
      JSON.stringify({ relationshipId }), now),
    p(`DELETE FROM couple_write_guards WHERE operation_id=?`, operationId)
  ];
}

// One same-database transaction, including ending any relationship and proposals.
export function removeCoupleFriendStatements(db, { userId, targetId, now, block = false }) {
  const a = Math.min(userId,targetId), b = Math.max(userId,targetId);
  const p = (sql, ...args) => db.prepare(sql).bind(...args);
  return [
    ...(block ? [p(`INSERT OR IGNORE INTO user_blocks(blocker_user_id,blocked_user_id) VALUES(?,?)`, userId,targetId)] : []),
    p(`DELETE FROM friendships WHERE user_one_id=? AND user_two_id=?`, a,b),
    p(`INSERT INTO couple_audit SELECT id || ':' || (version+1),id,?, ?,? FROM couple_relationships
       WHERE user_a_id=? AND user_b_id=? AND status='active'`,userId,block?'blocked':'unfriended',now,a,b),
    p(`UPDATE couple_date_proposals SET status='invalidated',responded_at=? WHERE status='pending'
       AND relationship_id IN(SELECT id FROM couple_relationships WHERE user_a_id=? AND user_b_id=? AND status='active')`,now,a,b),
    p(`DELETE FROM couple_active_members WHERE relationship_id IN
       (SELECT id FROM couple_relationships WHERE user_a_id=? AND user_b_id=? AND status='active')`,a,b),
    p(`UPDATE couple_relationships SET status='ended',version=version+1,ended_at=?,updated_at=?,ended_reason=?
       WHERE user_a_id=? AND user_b_id=? AND status='active'`,now,now,block?'blocked':'unfriended',a,b),
    p(`UPDATE couple_requests SET status='invalidated',responded_at=? WHERE user_a_id=? AND user_b_id=? AND status='pending'`,now,a,b),
    p(`UPDATE friend_requests SET status='cancelled',responded_at=?,updated_at=? WHERE status='pending'
      AND ((sender_user_id=? AND receiver_user_id=?) OR (sender_user_id=? AND receiver_user_id=?))`,now,now,userId,targetId,targetId,userId),
    p(`UPDATE room_invites SET status='cancelled',responded_at=?,updated_at=? WHERE status='pending'
      AND ((inviter_user_id=? AND invitee_user_id=?) OR (inviter_user_id=? AND invitee_user_id=?))`,now,now,userId,targetId,targetId,userId)
  ];
}
