import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { acceptCoupleStatements, removeCoupleFriendStatements } from '../src/features/couple_transactions.js';

const db=env.SOCIAL_DB, now='2026-11-04T04:00:00.000Z';
beforeAll(async()=>{
  // exec() accepts statements one per line; migration source has multiline DDL.
  await applyD1Migrations(db,env.SOCIAL_MIGRATIONS);
  await applyD1Migrations(env.GAME_DB,env.GAME_MIGRATIONS);
  await env.DB.prepare('CREATE TABLE users(id INTEGER PRIMARY KEY)').run();
  await env.DB.prepare('INSERT INTO users VALUES(1)').run();
  for(const sql of env.MAIN_LIFECYCLE_SQL.split(';').map(s=>s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});
beforeEach(async()=>{
  for(const t of ['couple_audit','couple_operations','couple_write_guards','couple_date_proposals',
    'couple_active_members','couple_requests','couple_relationships','account_tombstones','user_blocks','friendships'])
    await db.prepare(`DELETE FROM ${t}`).run();
});
async function invite(id,a=1,b=2){
  await db.prepare('INSERT OR IGNORE INTO friendships(user_one_id,user_two_id) VALUES(?,?)').bind(Math.min(a,b),Math.max(a,b)).run();
  await db.prepare(`INSERT INTO couple_requests(id,user_a_id,user_b_id,requester_id,recipient_id,proposed_started_on,status,created_at,expires_at)
    VALUES(?,?,?,?,?,'2026-11-01','pending','2026-11-04T00:00:00.000Z','2026-11-11T00:00:00.000Z')`)
    .bind(id,Math.min(a,b),Math.max(a,b),a,b).run();
}
function accept(id,actor=2,op=`op-${id}`){return db.batch(acceptCoupleStatements(db,{
  requestId:id,actorId:actor,relationshipId:`rel-${id}`,operationId:op,requestHash:`hash-${id}`,now}));}
async function count(table){return (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;}
async function healthy(){
  expect(await count('couple_write_guards')).toBe(0);
  const invalid=await db.prepare(`SELECT r.id FROM couple_relationships r WHERE
    (r.status='active' AND (SELECT count(*) FROM couple_active_members m WHERE m.relationship_id=r.id) != 2)
    OR (r.status='ended' AND EXISTS(SELECT 1 FROM couple_active_members m WHERE m.relationship_id=r.id))`).all();
  expect(invalid.results).toEqual([]);
}
test('three isolated bindings; internal FK survives without users copy',async()=>{
  expect(await db.prepare("SELECT name FROM sqlite_master WHERE name='users'").first()).toBeNull();
  expect(await env.GAME_DB.prepare("SELECT name FROM sqlite_master WHERE name='friendships'").first()).toBeNull();
  await expect(db.prepare("INSERT INTO couple_active_members VALUES(9,'missing')").run()).rejects.toThrow();
});
test('main lifecycle initializes existing account and tracks delivery separately per target',async()=>{
  expect(await env.DB.prepare('SELECT lifecycle_status,lifecycle_epoch FROM users WHERE id=1').first())
    .toEqual({lifecycle_status:'active',lifecycle_epoch:1});
  await env.DB.prepare("INSERT INTO lifecycle_outbox VALUES('event',1,2,'disabled','{}',?)").bind(now).run();
  await env.DB.batch(['social','games'].map(target=>env.DB.prepare(
    "INSERT INTO lifecycle_outbox_deliveries(event_id,target,next_attempt_at) VALUES('event',?,?)").bind(target,now)));
  expect((await env.DB.prepare('SELECT count(*) n FROM lifecycle_outbox_deliveries').first()).n).toBe(2);
});
test('game schema keeps local deck/card FK; no main account table required',async()=>{
  const game=env.GAME_DB;
  await game.prepare("INSERT INTO mini_royale_user_decks(id,user_id,name) VALUES(11,999,'local')").run();
  await expect(game.prepare("INSERT INTO mini_royale_user_deck_cards VALUES(11,0,'missing')").run()).rejects.toThrow();
  await game.prepare("INSERT INTO mini_royale_cards(id,name,elixir_cost,type) VALUES('card','Card',1,'melee')").run();
  await game.prepare("INSERT INTO mini_royale_user_deck_cards VALUES(11,0,'card')").run();
  expect((await game.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
test('accept writes two members, consumes request and records operation',async()=>{
  await invite('a'); await accept('a');
  expect(await count('couple_active_members')).toBe(2);
  expect(await count('couple_operations')).toBe(1); await healthy();
});
test('second member conflict rolls back first member, relation, audit and ledger',async()=>{
  await invite('existing',2,3); await accept('existing',3);
  await invite('new',1,2); await expect(accept('new')).rejects.toThrow();
  expect(await db.prepare('SELECT * FROM couple_active_members WHERE user_id=1').first()).toBeNull();
  expect(await count('couple_relationships')).toBe(1);
  expect(await count('couple_operations')).toBe(1); await healthy();
});
test('guard rejects zero-row conditional insert and rolls back',async()=>{
  await invite('a'); await expect(accept('a',3)).rejects.toThrow();
  expect(await count('couple_relationships')).toBe(0);
  expect(await count('couple_operations')).toBe(0); await healthy();
});
test('duplicate operation on another relation rolls back all new writes',async()=>{
  await invite('a'); await accept('a',2,'same');
  await db.batch(removeCoupleFriendStatements(db,{userId:1,targetId:2,now}));
  await invite('b'); await expect(accept('b',2,'same')).rejects.toThrow();
  expect(await count('couple_relationships')).toBe(1); await healthy();
});
test('two concurrent invitations involving one user yield exactly one acceptance',async()=>{
  await invite('a',1,2); await invite('b',1,3);
  const result=await Promise.allSettled([accept('a',2),accept('b',3)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await count('couple_relationships')).toBe(1); await healthy();
});
for(const block of [false,true]) test(`accept races ${block?'block':'remove'} without revival`,async()=>{
  await invite('a');
  const results=await Promise.allSettled([accept('a'),db.batch(removeCoupleFriendStatements(db,{userId:1,targetId:2,now,block}))]);
  expect(results[1].status).toBe('fulfilled');
  expect(await count('couple_active_members')).toBe(0);
  expect(await db.prepare("SELECT id FROM couple_relationships WHERE status='active'").first()).toBeNull(); await healthy();
});
test('expiry boundary and account tombstone prevent acceptance',async()=>{
  await invite('a');
  await db.prepare('UPDATE couple_requests SET expires_at=?').bind(now).run();
  await expect(accept('a')).rejects.toThrow();
  await db.prepare("UPDATE couple_requests SET expires_at='2026-11-11T00:00:00.000Z'").run();
  await db.prepare("INSERT INTO account_tombstones VALUES(1,2,'disabled',?)").bind(now).run();
  await expect(accept('a')).rejects.toThrow(); await healthy();
});
test('pending pair and proposal uniqueness; block invalidates pending date',async()=>{
  await invite('a'); await expect(invite('reverse',2,1)).rejects.toThrow(); await accept('a');
  const proposal=`INSERT INTO couple_date_proposals VALUES(?,'rel-a',1,'2026-10-01',1,'pending',?, '2026-11-11T00:00:00.000Z',NULL)`;
  await db.prepare(proposal).bind('p1',now).run();
  await expect(db.prepare(proposal).bind('p2',now).run()).rejects.toThrow();
  await db.batch(removeCoupleFriendStatements(db,{userId:1,targetId:2,now,block:true}));
  expect((await db.prepare("SELECT status FROM couple_date_proposals WHERE id='p1'").first()).status).toBe('invalidated'); await healthy();
});
