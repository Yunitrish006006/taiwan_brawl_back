import { env } from 'cloudflare:workers';
import { applyD1Migrations,evictDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import worker from '../src/index.js';
import { handleApiRequest } from '../src/api/api_router.js';
import { terminateAccount,deliverLifecycle,drainLifecycleOutbox } from '../src/features/account_lifecycle.js';
import { sendFriendRequest,respondToFriendRequest } from '../src/features/friends_repository.js';
import { socialDatabase } from '../src/core/databases.js';
import { recordMatchHistory } from '../src/royale/royale_repository.js';
import { ChatRoom } from '../src/rooms/chat_room.js';
import { SignalRoom } from '../src/rooms/signal_room.js';
import { createSession } from '../src/core/auth.js';

const live={...env,DATABASE_MODE:'split',ENABLE_COUPLES_API:'true'};
const social=env.SOCIAL_DB,main=env.DB,game=env.GAME_DB;
beforeAll(async()=>{
  await applyD1Migrations(main,env.MAIN_MIGRATIONS);
  await applyD1Migrations(social,env.SOCIAL_MIGRATIONS);
  await applyD1Migrations(game,env.GAME_MIGRATIONS);
});
beforeEach(async()=>{
  for(const t of ['couple_audit','couple_operations','couple_write_guards','couple_date_proposals','couple_active_members','couple_requests','couple_relationships',
    'chat_pending_message_acks','pending_messages','chat_messages','chat_devices','room_invites','friend_requests','friendships','user_blocks','lifecycle_receipts','account_tombstones']) await social.prepare(`DELETE FROM ${t}`).run();
  for(const t of ['mini_royale_user_deck_character_events','mini_royale_user_deck_characters','mini_royale_user_deck_cards','mini_royale_user_decks','mini_royale_match_history','lifecycle_receipts','account_tombstones']) await game.prepare(`DELETE FROM ${t}`).run();
  for(const t of ['friendships','friend_requests','room_invites','user_blocks','chat_pending_message_acks','chat_devices','pending_messages','chat_messages','sessions','lifecycle_outbox_deliveries','lifecycle_outbox','lifecycle_write_guards','push_registrations','users']) await main.prepare(`DELETE FROM ${t}`).run();
  for(const id of [101,102,103]) {
    await main.prepare("INSERT INTO users(id,name,email,role) VALUES(?,?,?,?)").bind(id,`User ${id}`,`${id}@example.test`,id===103?'admin':'player').run();
    await main.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,'2099-01-01')").bind(`session-${id}`,id).run();
  }
  await social.prepare('INSERT INTO friendships(user_one_id,user_two_id) VALUES(101,102)').run();
});
const op=()=>crypto.randomUUID();
async function call(actor,method,path,body,settings={}) {
  const req=new Request(`https://social.test${path}`,{method,headers:{Authorization:`Bearer session-${actor}`,'Content-Type':'application/json',...(path.startsWith('/api/couples/')?{'X-Expected-Account-ID':String(actor)}:{}),...settings.headers},body:body===undefined?undefined:JSON.stringify(body)});
  const r=await handleApiRequest(req,settings.env??live,new URL(req.url));return {status:r.status,json:await r.json()};
}
async function paired(){
  const q=await call(101,'POST','/api/couples/requests',{targetUserId:102,startedOn:'2000-01-01',timeZone:'UTC',operationId:op()});
  expect(q.status).toBe(201);
  const r=await call(102,'POST',`/api/couples/requests/${q.json.data.request.id}/accept`,{timeZone:'UTC',operationId:op()});
  expect(r.status).toBe(200);return r.json.data.relationship;
}
const count=async(db,t)=>(await db.prepare(`SELECT count(*) n FROM ${t}`).first()).n;

test('split overview joins public profiles in service and never needs users in SOCIAL_DB',async()=>{
  const r=await call(101,'GET','/api/friends/overview');
  expect(r.status).toBe(200);expect(r.json.friends).toHaveLength(1);
  expect(r.json.friends[0]).toMatchObject({userId:102,name:'User 102'});
  expect(r.json.friends[0]).not.toHaveProperty('email');
  expect(await social.prepare("SELECT name FROM sqlite_master WHERE name='users'").first()).toBeNull();
});
for(const block of [false,true]) test(`real ${block?'block':'remove'} route ends couples and invalidates date proposal atomically`,async()=>{
  const r=await paired();
  await call(101,'POST',`/api/couples/${r.id}/date-proposals`,{startedOn:'1999-01-01',timeZone:'UTC',expectedVersion:1,operationId:op()});
  const response=block?await call(101,'POST','/api/friends/block',{targetUserId:102}):await call(101,'DELETE','/api/friends/102');
  expect(response.status).toBe(200);expect(response.json).toEqual({ok:true});
  expect(await count(social,'friendships')).toBe(0);expect(await count(social,'couple_active_members')).toBe(0);
  expect((await social.prepare('SELECT status FROM couple_date_proposals').first()).status).toBe('invalidated');
  expect((await call(102,'GET','/api/couples/overview')).json.data.relationship).toBeNull();
});
test('chat registration writes only social DB and block prevents pending sends',async()=>{
  const registered=await call(101,'POST','/api/chat/dm/device-register',{deviceId:'phone'});
  expect(registered.status).toBe(200);expect(await count(social,'chat_devices')).toBe(1);expect(await count(main,'chat_devices')).toBe(0);
  await call(101,'POST','/api/friends/block',{targetUserId:102});
  expect((await call(102,'POST','/api/chat/dm/101/send',{text:'not allowed'})).status).toBe(403);
  expect((await call(102,'GET','/api/chat/dm/101/sync-download-v2')).status).toBe(403);
});
test('failed atomic block rolls back friendship, couple status and block insertion',async()=>{
  await paired();
  await social.prepare("CREATE TRIGGER test_fail_end BEFORE UPDATE ON couple_relationships BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try {
    expect((await call(101,'POST','/api/friends/block',{targetUserId:102})).status).toBe(400);
    expect(await count(social,'friendships')).toBe(1);expect(await count(social,'user_blocks')).toBe(0);expect(await count(social,'couple_active_members')).toBe(2);
  } finally {await social.prepare('DROP TRIGGER test_fail_end').run();}
});
test('termination revokes sessions and durably records both targets in one main transaction',async()=>{
  const id=op();const event=await terminateAccount(live,101,'disabled',id);
  expect(event.epoch).toBe(2);expect(await count(main,'lifecycle_outbox_deliveries')).toBe(2);
  expect(await main.prepare('SELECT id FROM sessions WHERE user_id=101').first()).toBeNull();
  expect((await call(101,'GET','/api/friends/overview')).status).toBe(401);
  expect((await terminateAccount(live,101,'disabled',id)).event_id).toBe(id);
  expect(await count(main,'lifecycle_outbox')).toBe(1);
  expect(await createSession(101,live)).toBeNull();
});
test('main outbox failure rolls back account state and session revocation',async()=>{
  await main.prepare("CREATE TRIGGER test_fail_delivery BEFORE INSERT ON lifecycle_outbox_deliveries BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  try {
    await expect(terminateAccount(live,101,'disabled',op())).rejects.toThrow();
    expect((await main.prepare('SELECT lifecycle_status FROM users WHERE id=101').first()).lifecycle_status).toBe('active');
    expect(await main.prepare('SELECT id FROM sessions WHERE user_id=101').first()).not.toBeNull();
    expect(await count(main,'lifecycle_outbox')).toBe(0);
  } finally {await main.prepare('DROP TRIGGER test_fail_delivery').run();}
});
test('delivery cleans social and game references but preserves peers, cards and main account record',async()=>{
  await paired();const now=new Date().toISOString();
  await social.prepare("INSERT INTO friend_requests(sender_user_id,receiver_user_id) VALUES(101,103)").run();
  await social.prepare("INSERT INTO room_invites(room_code,inviter_user_id,invitee_user_id) VALUES('ROOM',101,102)").run();
  await social.prepare("INSERT INTO pending_messages(sender_id,receiver_id,text) VALUES(101,102,'ciphertext')").run();
  await game.prepare("INSERT INTO mini_royale_user_decks(id,user_id,name) VALUES(11,101,'A'),(12,102,'B')").run();
  const event=await terminateAccount(live,101,'disabled',op());
  expect((await drainLifecycleOutbox(live)).delivered).toBe(2);
  expect(await count(social,'couple_active_members')).toBe(0);expect(await count(social,'pending_messages')).toBe(0);
  expect((await social.prepare('SELECT status FROM room_invites').first()).status).toBe('cancelled');
  expect((await game.prepare('SELECT user_id FROM mini_royale_user_decks').all()).results).toEqual([{user_id:102}]);
  expect(await main.prepare('SELECT id FROM users WHERE id=101').first()).not.toBeNull();
  await deliverLifecycle(live,event,'social');expect(await count(social,'lifecycle_receipts')).toBe(1);
});
test('target failure is retried independently, with no premature acknowledgement',async()=>{
  const start='2030-01-01T00:00:00.000Z';const event=await terminateAccount(live,101,'disabled',op(),start);
  const unavailable={...live,GAME_DB:{prepare(){throw new Error('offline');}}};
  expect(await drainLifecycleOutbox(unavailable,start)).toMatchObject({delivered:1,failed:1});
  const rows=(await main.prepare('SELECT * FROM lifecycle_outbox_deliveries ORDER BY target').all()).results;
  expect(rows[0].target).toBe('games');expect(rows[0].completed_at).toBeNull();expect(rows[0].attempt).toBe(1);
  expect(rows[0].next_attempt_at).toBe('2030-01-01T00:01:00.000Z');
  expect((await drainLifecycleOutbox(live,'2030-01-01T00:01:00.000Z')).delivered).toBe(1);
  expect(await count(game,'lifecycle_receipts')).toBe(1);
});
test('overdue monitoring includes failures waiting for a future retry',async()=>{
  const at='2030-01-01T00:00:00.000Z';
  await terminateAccount(live,101,'disabled',op(),at);
  await main.prepare("UPDATE lifecycle_outbox_deliveries SET next_attempt_at='2030-01-02T00:00:00.000Z'").run();
  expect(await drainLifecycleOutbox(live,'2030-01-01T00:06:00.000Z')).toEqual({delivered:0,failed:0,overdue:2});
});
test('out-of-order lifecycle events cannot lower tombstone epoch or reopen account',async()=>{
  const a=await terminateAccount(live,101,'disabled',op()),b=await terminateAccount(live,101,'deleting',op());
  await deliverLifecycle(live,b,'social');await deliverLifecycle(live,a,'social');
  expect(await social.prepare('SELECT epoch,status FROM account_tombstones WHERE user_id=101').first()).toEqual({epoch:3,status:'deleting'});
  await expect(terminateAccount(live,101,'disabled',op())).rejects.toThrow();
});
test('late social and game writes are rejected by tombstone triggers',async()=>{
  const event=await terminateAccount(live,101,'disabled',op());
  await deliverLifecycle(live,event,'social');await deliverLifecycle(live,event,'games');
  await expect(social.prepare("INSERT INTO pending_messages(sender_id,receiver_id,text) VALUES(101,102,'late')").run()).rejects.toThrow();
  await expect(social.prepare('INSERT INTO friendships(user_one_id,user_two_id) VALUES(101,102)').run()).rejects.toThrow();
  await expect(game.prepare("INSERT INTO mini_royale_user_decks(user_id,name) VALUES(101,'late')").run()).rejects.toThrow();
});
test('only admin can request lifecycle transition and malicious Origin is denied',async()=>{
  const path='/api/admin/users/101/lifecycle',b={status:'disabled',operationId:op()};
  expect((await call(102,'POST',path,b)).status).toBe(403);
  expect((await call(103,'POST',path,b,{headers:{Origin:'https://evil.test'}})).status).toBe(403);
  expect((await call(103,'POST',path,b)).status).toBe(200);
  expect((await call(101,'GET','/api/me')).status).toBe(401);
});
test('scheduled handler drains durable outbox using waitUntil',async()=>{
  await terminateAccount(live,101,'disabled',op());let pending;
  await worker.scheduled({},live,{waitUntil(p){pending=p;}});await pending;
  expect(await count(social,'lifecycle_receipts')).toBe(1);expect(await count(game,'lifecycle_receipts')).toBe(1);
});
test('missing split binding never falls back to legacy DB',async()=>{
  expect(()=>socialDatabase({...live,SOCIAL_DB:null})).toThrow();
  expect(await count(socialDatabase({...live,DATABASE_MODE:'legacy'}),'users')).toBe(3);
});
test('game match writer uses game DB and rejects stopped accounts before insert',async()=>{
  const match={roomCode:'ROOM',playerOneUserId:101,playerTwoUserId:102,winnerUserId:101,reason:'finished',playerOneTowerHp:100,playerTwoTowerHp:0,summary:{}};
  await recordMatchHistory(live,match);expect(await count(game,'mini_royale_match_history')).toBe(1);expect(await count(main,'mini_royale_match_history')).toBe(0);
  await terminateAccount(live,101,'disabled',op());await expect(recordMatchHistory(live,match)).rejects.toThrow();
});
test('connected chat and signal consumers recheck account authority after termination',async()=>{
  await terminateAccount(live,101,'disabled',op());
  const chat=new ChatRoom({},live);
  await expect(chat.handleSendMessage(101,{receiverId:102,text:'late'})).rejects.toThrow();
  const socket={close:viClose};let closed=false;function viClose(){closed=true;}
  const signal=new SignalRoom({getWebSockets(){return[];}},live);
  await signal._authorizedMessage(101,JSON.stringify({type:'offer',targetUserId:102,sdp:'v=0'}),socket);
  expect(closed).toBe(true);
});
test('real accept competes with block without recreating friendship or couple',async()=>{
  const q=await call(101,'POST','/api/couples/requests',{targetUserId:102,startedOn:'2000-01-01',timeZone:'UTC',operationId:op()});
  const results=await Promise.all([
    call(102,'POST',`/api/couples/requests/${q.json.data.request.id}/accept`,{timeZone:'UTC',operationId:op()}),
    call(101,'POST','/api/friends/block',{targetUserId:102})
  ]);
  expect(results[1].status).toBe(200);expect(await count(social,'couple_active_members')).toBe(0);expect(await count(social,'friendships')).toBe(0);
});
test('friend acceptance race cannot reverse a committed block',async()=>{
  await social.prepare('DELETE FROM friendships').run();
  await sendFriendRequest(101,102,live);
  const q=await social.prepare('SELECT id FROM friend_requests').first();
  await Promise.allSettled([respondToFriendRequest(102,q.id,'accept',live),call(101,'POST','/api/friends/block',{targetUserId:102})]);
  expect(await count(social,'friendships')).toBe(0);expect(await count(social,'user_blocks')).toBe(1);
});
test('target commit followed by lost ack retries without duplicate side effects',async()=>{
  await paired();const at='2030-01-01T00:00:00.000Z';
  const event=await terminateAccount(live,101,'disabled',op(),at);
  await deliverLifecycle(live,event,'social',at); // Target committed, producer still has no ack.
  const audits=await count(social,'couple_audit');
  expect((await drainLifecycleOutbox(live,at)).delivered).toBe(2);
  expect(await count(social,'couple_audit')).toBe(audits);expect(await count(social,'lifecycle_receipts')).toBe(1);
});
test('ordinary friend request/search/accept/unblock and room invite consumer payloads survive split mode',async()=>{
  await social.prepare('DELETE FROM friendships').run();
  expect((await call(101,'POST','/api/friends/requests',{targetUserId:102})).status).toBe(200);
  const incoming=(await call(102,'GET','/api/friends/overview')).json.incomingRequests[0];
  expect(incoming.user.userId).toBe(101);
  expect((await call(102,'POST',`/api/friends/requests/${incoming.id}/accept`,{})).status).toBe(200);
  expect((await call(101,'GET','/api/friends/search?query=User')).json.results.length).toBe(3);
  const {sendRoomInvite}=await import('../src/features/friends_repository.js');
  await sendRoomInvite(101,102,'ROOM',live);
  const invite=(await call(102,'GET','/api/friends/overview')).json.roomInvites[0];
  expect(invite).toMatchObject({gameId:'game.mini-royale',roomCode:'ROOM',inviter:{userId:101}});
  expect((await call(102,'POST',`/api/room-invites/${invite.id}/accept`,{})).status).toBe(200);
  await call(101,'POST','/api/friends/block',{targetUserId:102});
  expect((await call(101,'DELETE','/api/friends/block/102')).status).toBe(200);
  expect(await count(social,'user_blocks')).toBe(0);
});
test('real SignalRoom after hibernation relays authorized SDP then closes a terminated sender',async()=>{
  const room=env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName('signal:101:102'));
  const connect=async id=>{
    const r=await room.fetch('https://signal.test/internal/signal',{headers:{Upgrade:'websocket','x-user-id':String(id)}});
    const socket=r.webSocket;socket.accept();return socket;
  };
  const sender=await connect(101),receiver=await connect(102);
  const event=(socket,type)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${type}`)),3000);
    socket.addEventListener(type,e=>{clearTimeout(timer);resolve(e);},{once:true});
  });
  try {
    await evictDurableObject(room);
    const incoming=event(receiver,'message');
    sender.send(JSON.stringify({type:'offer',targetUserId:102,sdp:'v=0\r\n'}));
    expect(JSON.parse((await incoming).data).fromUserId).toBe(101);
    await terminateAccount(live,101,'disabled',op());
    const closed=event(sender,'close');
    sender.send(JSON.stringify({type:'offer',targetUserId:102,sdp:'v=0\r\n'}));
    expect((await closed).code).toBe(1008);
  } finally {sender.close(1000,'test complete');receiver.close(1000,'test complete');}
});
