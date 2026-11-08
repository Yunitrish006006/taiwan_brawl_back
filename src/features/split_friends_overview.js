import { socialDatabase } from '../core/databases.js';

// Profiles stay in the account DB; only explicit public fields cross this boundary.
export async function splitFriendsOverview(actor, env) {
  const db=socialDatabase(env);
  const friends=(await db.prepare(`SELECT CASE WHEN user_one_id=? THEN user_two_id ELSE user_one_id END AS user_id
    FROM friendships WHERE user_one_id=? OR user_two_id=?`).bind(actor,actor,actor).all()).results;
  const incoming=(await db.prepare("SELECT id,created_at,sender_user_id AS user_id FROM friend_requests WHERE receiver_user_id=? AND status='pending' ORDER BY created_at DESC,id DESC").bind(actor).all()).results;
  const outgoing=(await db.prepare("SELECT id,created_at,receiver_user_id AS user_id FROM friend_requests WHERE sender_user_id=? AND status='pending' ORDER BY created_at DESC,id DESC").bind(actor).all()).results;
  const blocked=(await db.prepare('SELECT blocked_user_id AS user_id FROM user_blocks WHERE blocker_user_id=? ORDER BY created_at DESC').bind(actor).all()).results;
  const invites=(await db.prepare("SELECT id,game_id,room_code,created_at,inviter_user_id AS user_id FROM room_invites WHERE invitee_user_id=? AND status='pending' ORDER BY created_at DESC,id DESC").bind(actor).all()).results;
  const profiles=new Map();
  const ids=[...new Set([...friends,...incoming,...outgoing,...blocked,...invites].map(r=>r.user_id))];
  for(let i=0;i<ids.length;i+=50) {
    const part=ids.slice(i,i+50);
    const rows=(await env.DB.prepare(`SELECT id,name,bio,avatar_url,last_active_at FROM users WHERE lifecycle_status='active' AND id IN (${part.map(()=>'?').join(',')})`).bind(...part).all()).results;
    for(const u of rows) profiles.set(u.id,{userId:u.id,name:u.name,bio:u.bio??'',avatarUrl:u.avatar_url??null,
      lastActiveAt:u.last_active_at??null,isOnline:Boolean(u.last_active_at && Date.now()-Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(u.last_active_at)?u.last_active_at:u.last_active_at.replace(' ','T')+'Z')<300000)});
  }
  const users=rows=>rows.filter(r=>profiles.has(r.user_id)).map(r=>profiles.get(r.user_id));
  const requests=rows=>rows.filter(r=>profiles.has(r.user_id)).map(r=>({id:r.id,createdAt:r.created_at,user:profiles.get(r.user_id)}));
  return {friends:users(friends).sort((a,b)=>Number(b.isOnline)-Number(a.isOnline)||a.name.localeCompare(b.name)),
    incomingRequests:requests(incoming),outgoingRequests:requests(outgoing),blockedUsers:users(blocked),
    roomInvites:invites.filter(r=>profiles.has(r.user_id)).map(r=>({id:r.id,gameId:r.game_id,roomCode:r.room_code,createdAt:r.created_at,inviter:profiles.get(r.user_id)}))};
}
