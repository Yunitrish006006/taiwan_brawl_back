import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest';
import { handleApiRequest } from '../src/api/api_router.js';
import { removeCoupleFriendStatements } from '../src/features/couple_transactions.js';

const db=env.SOCIAL_DB, fixtures=JSON.parse(env.COUPLE_FIXTURES);
const live={...env,ENABLE_COUPLES_API:'true',DATABASE_MODE:'split'};
const fixed='2026-11-04T04:00:00.000Z';
const op=()=>crypto.randomUUID();
const body=extra=>({operationId:op(),...extra});
beforeAll(async()=>{
  await env.DB.prepare(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL DEFAULT '',lifecycle_status TEXT NOT NULL DEFAULT 'active')`).run();
  await env.DB.prepare('CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT)').run();
  await applyD1Migrations(db,env.SOCIAL_MIGRATIONS);
});
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(fixed));
  for(const t of ['couple_audit','couple_operations','couple_write_guards','couple_date_proposals','couple_active_members',
    'couple_requests','couple_relationships','account_tombstones','user_blocks','friendships']) await db.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare('DELETE FROM sessions').run();await env.DB.prepare('DELETE FROM users').run();
  for(const id of [101,102,103]) {
    await env.DB.prepare('INSERT INTO users(id) VALUES(?)').bind(id).run();
    await env.DB.prepare("INSERT INTO sessions VALUES(?,?,'2099-01-01T00:00:00Z')").bind(`s-${id}`,id).run();
  }
  await db.prepare('INSERT INTO friendships(user_one_id,user_two_id) VALUES(101,102),(101,103)').run();
});
afterEach(()=>vi.useRealTimers());
async function call(actor,method,path,payload,options={}) {
  const headers={...(actor?{Authorization:`Bearer s-${actor}`,'X-Expected-Account-ID':String(actor)}:{})};
  if(payload!==undefined) headers['Content-Type']='application/json';
  Object.assign(headers,options.headers);
  if(options.cookie){delete headers.Authorization;headers.Cookie=`session_id=s-${actor}`;}
  const request=new Request(`https://couples.test${path}`,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)});
  const response=await handleApiRequest(request,options.env??live,new URL(request.url));
  return {status:response.status,headers:response.headers,json:await response.json()};
}
const send=(actor,payload,options)=>call(actor,'POST','/api/couples/requests',payload,options);
const action=(actor,q,a,payload=body({}),options)=>call(actor,'POST',`/api/couples/requests/${q}/${a}`,payload,options);
async function invited(){const r=await send(101,body({targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'}));expect(r.status).toBe(201);return r.json.data.request;}
async function paired(){const q=await invited();const r=await action(102,q.id,'accept',body({timeZone:'Asia/Taipei'}));expect(r.status).toBe(200);return r.json.data.relationship;}
const propose=(actor,r,payload)=>call(actor,'POST',`/api/couples/${r}/date-proposals`,payload);
const dateAction=(actor,q,a,payload)=>call(actor,'POST',`/api/couples/date-proposals/${q}/${a}`,payload??body({}));
const end=(actor,r,payload)=>call(actor,'POST',`/api/couples/${r}/end`,payload??body({}));
const overview=actor=>call(actor,'GET','/api/couples/overview');

test('overview includes only the current partner name and refreshes profile changes',async()=>{
  await paired();
  await env.DB.prepare('UPDATE users SET name=? WHERE id=102').bind('Partner name').run();
  expect((await overview(101)).json.data.relationship.partnerName).toBe('Partner name');
  expect((await overview(103)).json.data.relationship).toBeNull();
  await env.DB.prepare('UPDATE users SET name=? WHERE id=102').bind('  Updated\nname  ').run();
  expect((await overview(101)).json.data.relationship.partnerName).toBe('Updated name');
});

test('disabled API and missing bindings fail closed; unauthenticated is typed 401',async()=>{
  expect((await overview(0)).status).toBe(401);
  expect((await call(101,'GET','/api/couples/overview',undefined,{env})).status).toBe(503);
  expect((await call(101,'GET','/api/couples/overview',undefined,{env:{...live,SOCIAL_DB:null}})).status).toBe(503);
});
test('credential switching cannot read or mutate another selected account',async()=>{
  await paired();
  const mismatched={headers:{'X-Expected-Account-ID':'101'}};
  const read=await call(102,'GET','/api/couples/overview',undefined,mismatched);
  expect(read.status).toBe(409);expect(read.json.error.code).toBe('ACCOUNT_MISMATCH');expect(read.json.data).toBeUndefined();
  const relation=(await overview(102)).json.data.relationship;
  const write=await call(102,'POST',`/api/couples/${relation.id}/end`,body({}),mismatched);
  expect(write.status).toBe(409);expect(write.json.error.code).toBe('ACCOUNT_MISMATCH');
  expect((await overview(102)).json.data.relationship.status).toBe('active');
  const missing=await call(102,'GET','/api/couples/overview',undefined,{headers:{'X-Expected-Account-ID':''}});
  expect(missing.status).toBe(409);expect(missing.json.error.code).toBe('ACCOUNT_MISMATCH');
});
test('shared contract fixture create request and 7-day expiry',async()=>{
  const f=fixtures.cases.find(c=>c.id==='create-request');
  const r=await send(f.actorUserId,f.request.body);
  expect(r.status).toBe(f.expectedStatus);
  const q=r.json.data.request;
  expect(q).toMatchObject({...f.expectedBody.data.request,id:expect.any(String),createdAt:expect.any(String),expiresAt:expect.any(String)});
  expect(Date.parse(q.expiresAt)-Date.parse(q.createdAt)).toBe(604800000);
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
});
test('complete invite, accept, overview, propose, accept date, end flow',async()=>{
  const r=await paired();
  expect((await overview(101)).json.data.relationship.partnerUserId).toBe(102);
  expect((await overview(102)).json.data.relationship.partnerUserId).toBe(101);
  const p=await propose(101,r.id,body({startedOn:'2026-10-01',timeZone:'Asia/Taipei',expectedVersion:1}));
  expect(p.status).toBe(201);
  expect((await overview(102)).json.data.relationship.startedOn).toBe('2026-11-01');
  const changed=await dateAction(102,p.json.data.proposal.id,'accept',body({timeZone:'Asia/Taipei'}));
  expect(changed.status).toBe(200);expect(changed.json.data.relationship.version).toBe(2);
  expect(changed.json.data.relationship.startedOn).toBe('2026-10-01');
  expect((await end(101,r.id)).json.data.relationship.status).toBe('ended');
  expect((await overview(102)).json.data.relationship).toBeNull();
  expect((await db.prepare('SELECT count(*) n FROM couple_active_members').first()).n).toBe(0);
});
test('third parties and wrong action actors get NOT_FOUND',async()=>{
  const q=await invited();
  for(const actor of [101,103]) expect((await action(actor,q.id,'accept',body({timeZone:'Asia/Taipei'}))).status).toBe(404);
  expect((await action(102,q.id,'cancel')).status).toBe(404);
  await action(102,q.id,'accept',body({timeZone:'Asia/Taipei'}));
  const r=(await overview(101)).json.data.relationship;
  expect((await end(103,r.id)).status).toBe(404);
  expect((await overview(103)).json.data.relationship).toBeNull();
});
test('cookie mutations require exact Origin; native bearer needs none',async()=>{
  const b=body({targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'});
  for(const headers of [{},{Origin:'https://evil.test'},{Origin:'null'}]) expect((await send(101,b,{cookie:true,headers})).status).toBe(403);
  expect((await send(101,b,{cookie:true,headers:{Origin:'https://couples.test'}})).status).toBe(201);
});
test('JSON body validation rejects unknown fields, invalid UUID and invalid date/timezone',async()=>{
  const base={targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'};
  for(const patch of [{actorId:103},{operationId:'bad'},{targetUserId:1.5}]) expect((await send(101,{...body(base),...patch})).status).toBe(400);
  for(const patch of [{startedOn:'2026-02-30'},{startedOn:'2026-11-05'},{startedOn:'1899-01-01'},{timeZone:'Not/AZone'}]) expect((await send(101,body({...base,...patch}))).status).toBe(422);
});
test('same operation replays original envelope, changed payload conflicts',async()=>{
  const b=body({targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'});
  const one=await send(101,b),two=await send(101,b);
  expect(two.status).toBe(201);expect(two.json).toEqual({...one.json,replayed:true});
  expect((await send(101,{...b,startedOn:'2026-10-01'})).json.error.code).toBe('OPERATION_ID_REUSED');
  expect((await db.prepare('SELECT count(*) n FROM couple_requests').first()).n).toBe(1);
});
test('reverse invitation returns pending without auto accepting; reject has no cooldown',async()=>{
  const q=await invited();
  const reverse=await send(102,body({targetUserId:101,startedOn:'2026-11-01',timeZone:'Asia/Taipei'}));
  expect(reverse.status).toBe(200);expect(reverse.json.data.request.id).toBe(q.id);
  expect((await action(102,q.id,'reject')).status).toBe(200);
  expect((await send(101,body({targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'}))).status).toBe(201);
});
test('cancel and rejection are terminal; expiry boundary prevents acceptance',async()=>{
  let q=await invited(); expect((await action(101,q.id,'cancel')).status).toBe(200);
  expect((await action(102,q.id,'accept',body({timeZone:'Asia/Taipei'}))).json.error.code).toBe('REQUEST_NOT_PENDING');
  q=await invited(); vi.setSystemTime(new Date(q.expiresAt));
  expect((await action(102,q.id,'accept',body({timeZone:'Asia/Taipei'}))).status).toBe(409);
  expect((await overview(102)).json.data.incomingRequests).toEqual([]);
  expect((await invited()).id).not.toBe(q.id);
});
test('inactive account, revoked/expired session and dependency failure do not expose state',async()=>{
  await env.DB.prepare("UPDATE users SET lifecycle_status='disabled' WHERE id=102").run();
  expect((await send(101,body({targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'}))).status).toBe(409);
  expect((await overview(102)).status).toBe(401);
  await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE user_id=101").run();
  expect((await overview(101)).status).toBe(401);
  const broken={...live,DB:{prepare(){throw new Error('secret database info');}}};
  const failed=await call(101,'GET','/api/couples/overview',undefined,{env:broken});
  expect(failed.status).toBe(503);expect(JSON.stringify(failed.json)).not.toContain('secret');
});
test('date proposal cannot be self accepted; reject/cancel leave original date unchanged',async()=>{
  const r=await paired();
  const create=()=>propose(101,r.id,body({startedOn:'2026-10-01',timeZone:'Asia/Taipei',expectedVersion:1}));
  let p=(await create()).json.data.proposal;
  expect((await dateAction(101,p.id,'accept',body({timeZone:'Asia/Taipei'}))).status).toBe(404);
  expect((await dateAction(102,p.id,'reject')).status).toBe(200);
  p=(await create()).json.data.proposal;
  expect((await dateAction(101,p.id,'cancel')).status).toBe(200);
  expect((await overview(101)).json.data.relationship.startedOn).toBe(r.startedOn);
  expect((await propose(101,r.id,body({startedOn:'2026-10-01',timeZone:'Asia/Taipei',expectedVersion:2}))).json.error.code).toBe('VERSION_CONFLICT');
});
test('end replays idempotently and old proposal cannot revive relationship',async()=>{
  const r=await paired();
  const p=(await propose(101,r.id,body({startedOn:'2026-10-01',timeZone:'Asia/Taipei',expectedVersion:1}))).json.data.proposal;
  const b=body({}),one=await end(101,r.id,b),two=await end(101,r.id,b);
  expect(two.json).toEqual({...one.json,replayed:true});
  expect((await dateAction(102,p.id,'accept',body({timeZone:'Asia/Taipei'}))).status).toBe(409);
});
test('competing accepts and same-operation concurrent requests commit once',async()=>{
  const q=await invited(),b=body({timeZone:'Asia/Taipei'});
  const results=await Promise.all([action(102,q.id,'accept',b),action(102,q.id,'accept',b)]);
  expect(results.map(r=>r.status)).toEqual([200,200]);
  expect((await db.prepare('SELECT count(*) n FROM couple_relationships').first()).n).toBe(1);
});
test('accept races block without leaving active members; response is sanitized',async()=>{
  const q=await invited();
  await Promise.all([action(102,q.id,'accept',body({timeZone:'Asia/Taipei'})),db.batch(removeCoupleFriendStatements(db,{userId:101,targetId:102,now:fixed,block:true}))]);
  expect((await db.prepare('SELECT count(*) n FROM couple_active_members').first()).n).toBe(0);
  expect((await overview(101)).json.data.relationship).toBeNull();
});
test('typed rate limit response keeps Retry-After without 24-hour rejection rule',async()=>{
  const kv={async get(){return '100';},async put(){}};
  const r=await call(101,'GET','/api/couples/overview',undefined,{env:{...live,CHAT_SYNC:kv}});
  expect(r.status).toBe(429);expect(r.json.error.code).toBe('RATE_LIMITED');expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
});
test('nonfriend, self, blocked and tombstoned participants cannot send invitations',async()=>{
  const sendTo=id=>send(101,body({targetUserId:id,startedOn:'2026-11-01',timeZone:'Asia/Taipei'}));
  expect((await sendTo(101)).status).toBe(409);
  await db.prepare('DELETE FROM friendships').run();expect((await sendTo(102)).status).toBe(409);
  await db.prepare('INSERT INTO friendships(user_one_id,user_two_id) VALUES(101,102)').run();
  await db.prepare('INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES(102,101)').run();expect((await sendTo(102)).status).toBe(409);
  await db.prepare('DELETE FROM user_blocks').run();
  await db.prepare("INSERT INTO account_tombstones VALUES(102,2,'disabled',?)").bind(fixed).run();expect((await sendTo(102)).status).toBe(409);
});
test('local date upper bound uses supplied timezone and invalid IDs stay private',async()=>{
  const r=await send(101,body({targetUserId:102,startedOn:'2026-11-04',timeZone:'America/Los_Angeles'}));
  expect(r.status).toBe(422);
  expect((await call(101,'POST',"/api/couples/' OR 1=1/end",body({}))).status).toBe(404);
});
test('accept date races end without revival and repeated end changes no version',async()=>{
  const r=await paired();
  const p=(await propose(101,r.id,body({startedOn:'2026-10-01',timeZone:'Asia/Taipei',expectedVersion:1}))).json.data.proposal;
  const result=await Promise.all([dateAction(102,p.id,'accept',body({timeZone:'Asia/Taipei'})),end(101,r.id)]);
  expect(result[1].status).toBe(200);
  const current=await db.prepare('SELECT * FROM couple_relationships WHERE id=?').bind(r.id).first();
  expect(current.status).toBe('ended');expect((await overview(102)).json.data.relationship).toBeNull();
  expect((await end(102,r.id)).status).toBe(409);
});
test('replay reauthorizes after logout; raw invalid and oversized JSON never writes',async()=>{
  const b=body({targetUserId:102,startedOn:'2026-11-01',timeZone:'Asia/Taipei'});
  await send(101,b);await env.DB.prepare("DELETE FROM sessions WHERE id='s-101'").run();
  expect((await send(101,b)).status).toBe(401);
  for(const [contentType,raw] of [['text/plain','{}'],['application/json','{'],['application/json',' '.repeat(17000)]]) {
    const request=new Request('https://couples.test/api/couples/requests',{method:'POST',headers:{Authorization:'Bearer s-102','X-Expected-Account-ID':'102','Content-Type':contentType},body:raw});
    const response=await handleApiRequest(request,live,new URL(request.url));
    expect(response.status).toBe(400);
    const error=await response.json();expect(response.headers.get('X-Request-ID')).toBe(error.requestId);
  }
});
test('declined proposal expiry and stale base version cannot alter active date',async()=>{
  const r=await paired();
  const p=(await propose(101,r.id,body({startedOn:'2026-10-01',timeZone:'Asia/Taipei',expectedVersion:1}))).json.data.proposal;
  await db.prepare('UPDATE couple_relationships SET version=2 WHERE id=?').bind(r.id).run();
  expect((await dateAction(102,p.id,'accept',body({timeZone:'Asia/Taipei'}))).json.error.code).toBe('VERSION_CONFLICT');
  vi.setSystemTime(new Date(p.expiresAt));
  expect((await dateAction(102,p.id,'accept',body({timeZone:'Asia/Taipei'}))).json.error.code).toBe('REQUEST_NOT_PENDING');
  expect((await overview(102)).json.data.relationship.startedOn).toBe(r.startedOn);
});
