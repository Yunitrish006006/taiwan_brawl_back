import { splitMode, socialDatabase, gameDatabase } from '../core/databases.js';

export async function terminateAccount(env,userId,status,eventId,now=new Date().toISOString()) {
  if(!splitMode(env)) throw new Error('Lifecycle requires split mode');
  if(!Number.isSafeInteger(userId)||userId<=0||!['disabled','deleting'].includes(status)||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) throw new Error('Invalid lifecycle command');
  const db=env.DB;
  const previous=await db.prepare('SELECT * FROM lifecycle_outbox WHERE event_id=?').bind(eventId).first();
  if(previous) {
    if(previous.user_id!==userId||previous.event_type!==status) throw new Error('Lifecycle operation conflict');
    return previous;
  }
  const user=await db.prepare('SELECT lifecycle_status,lifecycle_epoch FROM users WHERE id=?').bind(userId).first();
  if(!user) throw new Error('Player not found');
  if(user.lifecycle_status===status) {
    const last=await db.prepare('SELECT * FROM lifecycle_outbox WHERE user_id=? ORDER BY epoch DESC LIMIT 1').bind(userId).first();
    if(last) return last;
  }
  if(user.lifecycle_status==='deleting' && status!=='deleting') throw new Error('Account already deleting');
  const epoch=user.lifecycle_epoch+1;
  try {
    await db.batch([
      db.prepare('UPDATE users SET lifecycle_status=?,lifecycle_epoch=? WHERE id=? AND lifecycle_epoch=?').bind(status,epoch,userId,user.lifecycle_epoch),
      db.prepare(`INSERT INTO lifecycle_outbox SELECT ?,id,lifecycle_epoch,?,'{}',? FROM users WHERE id=? AND lifecycle_status=? AND lifecycle_epoch=?`).bind(eventId,status,now,userId,status,epoch),
      db.prepare(`INSERT INTO lifecycle_write_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM lifecycle_outbox WHERE event_id=?) THEN 1 ELSE 0 END)`).bind(eventId,eventId),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId),
      ...['social','games'].map(target=>db.prepare('INSERT INTO lifecycle_outbox_deliveries(event_id,target,next_attempt_at) VALUES(?,?,?)').bind(eventId,target,now)),
      db.prepare('DELETE FROM lifecycle_write_guards WHERE id=?').bind(eventId)
    ]);
  } catch(error) {
    const existing=await db.prepare('SELECT * FROM lifecycle_outbox WHERE user_id=? AND epoch=? AND event_type=?').bind(userId,epoch,status).first();
    if(existing) return existing;
    throw error;
  }
  return db.prepare('SELECT * FROM lifecycle_outbox WHERE event_id=?').bind(eventId).first();
}

export async function deliverLifecycle(env,event,target,now=new Date().toISOString()) {
  const {event_id:id,user_id:user,epoch,event_type:status}=event;
  if(!Number.isSafeInteger(user)||user<=0||!Number.isSafeInteger(epoch)||epoch<1||!['disabled','deleting'].includes(status)) throw new Error('Invalid lifecycle event');
  const db=target==='social'?socialDatabase(env):target==='games'?gameDatabase(env):null;
  if(!db) throw new Error('Invalid lifecycle target');
  if(await db.prepare('SELECT event_id FROM lifecycle_receipts WHERE event_id=?').bind(id).first()) return;
  const p=(sql,...args)=>db.prepare(sql).bind(...args);
  const statements=[
    p(`INSERT INTO account_tombstones VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET epoch=excluded.epoch,status=excluded.status,updated_at=excluded.updated_at WHERE excluded.epoch>account_tombstones.epoch`,user,epoch,status,now)
  ];
  if(target==='social') {
    const pair='user_a_id=? OR user_b_id=?';
    statements.push(
      p(`INSERT OR IGNORE INTO couple_audit SELECT ? || ':' || id,id,?,'account_terminated',? FROM couple_relationships WHERE (${pair}) AND status='active'`,id,user,now,user,user),
      p(`UPDATE couple_date_proposals SET status='invalidated',responded_at=? WHERE status='pending' AND relationship_id IN(SELECT id FROM couple_relationships WHERE ${pair})`,now,user,user),
      p(`DELETE FROM couple_active_members WHERE relationship_id IN(SELECT id FROM couple_relationships WHERE ${pair})`,user,user),
      p(`UPDATE couple_relationships SET status='ended',version=version+1,ended_at=?,updated_at=?,ended_reason='account_terminated' WHERE (${pair}) AND status='active'`,now,now,user,user),
      p(`UPDATE couple_requests SET status='invalidated',responded_at=? WHERE status='pending' AND (${pair})`,now,user,user),
      p('DELETE FROM friendships WHERE user_one_id=? OR user_two_id=?',user,user),
      p("UPDATE friend_requests SET status='cancelled',responded_at=?,updated_at=? WHERE status='pending' AND (sender_user_id=? OR receiver_user_id=?)",now,now,user,user),
      p("UPDATE room_invites SET status='cancelled',responded_at=?,updated_at=? WHERE status='pending' AND (inviter_user_id=? OR invitee_user_id=?)",now,now,user,user),
      p('DELETE FROM chat_pending_message_acks WHERE receiver_id=? OR pending_id IN(SELECT id FROM pending_messages WHERE sender_id=? OR receiver_id=?)',user,user,user),
      p('DELETE FROM pending_messages WHERE sender_id=? OR receiver_id=?',user,user),
      p('DELETE FROM chat_messages WHERE sender_id=? OR receiver_id=?',user,user),
      p('DELETE FROM chat_devices WHERE user_id=?',user)
    );
  } else {
    statements.push(
      p('DELETE FROM mini_royale_user_deck_character_events WHERE user_id=? OR deck_id IN(SELECT id FROM mini_royale_user_decks WHERE user_id=?)',user,user),
      p('DELETE FROM mini_royale_user_deck_characters WHERE user_id=? OR deck_id IN(SELECT id FROM mini_royale_user_decks WHERE user_id=?)',user,user),
      p('DELETE FROM mini_royale_user_deck_cards WHERE deck_id IN(SELECT id FROM mini_royale_user_decks WHERE user_id=?)',user),
      p('DELETE FROM mini_royale_user_decks WHERE user_id=?',user),
      p('DELETE FROM mini_royale_match_history WHERE player_one_user_id=? OR player_two_user_id=? OR winner_user_id=?',user,user,user)
    );
  }
  statements.push(p('INSERT OR IGNORE INTO lifecycle_receipts VALUES(?,?,?,?)',id,user,epoch,now));
  await db.batch(statements);
}

export async function drainLifecycleOutbox(env,now=new Date().toISOString()) {
  if(!splitMode(env)) return {delivered:0,failed:0,overdue:0};
  const due=(await env.DB.prepare(`SELECT o.*,d.target,d.attempt FROM lifecycle_outbox o JOIN lifecycle_outbox_deliveries d ON d.event_id=o.event_id
    WHERE d.completed_at IS NULL AND d.next_attempt_at<=? ORDER BY d.next_attempt_at,o.created_at LIMIT 100`).bind(now).all()).results;
  const result={delivered:0,failed:0,overdue:0};
  for(const event of due) {
    try {
      await deliverLifecycle(env,event,event.target,now);
      await env.DB.prepare('UPDATE lifecycle_outbox_deliveries SET completed_at=?,last_error_code=NULL WHERE event_id=? AND target=?').bind(now,event.event_id,event.target).run();
      result.delivered++;
    } catch {
      const delay=Math.min(60,2**Math.min(event.attempt,6))*60000;
      await env.DB.prepare(`UPDATE lifecycle_outbox_deliveries SET attempt=attempt+1,next_attempt_at=?,last_error_code='DELIVERY_FAILED' WHERE event_id=? AND target=? AND completed_at IS NULL`)
        .bind(new Date(Date.parse(now)+delay).toISOString(),event.event_id,event.target).run();
      result.failed++;
    }
  }
  const overdue=await env.DB.prepare(`SELECT count(*) AS n FROM lifecycle_outbox o JOIN lifecycle_outbox_deliveries d ON d.event_id=o.event_id
    WHERE d.completed_at IS NULL AND o.created_at<?`).bind(new Date(Date.parse(now)-300000).toISOString()).first();
  result.overdue=overdue.n;
  if(result.failed||result.overdue) console.warn('Lifecycle delivery pending',result);
  return result;
}
