import { parseSessionId, getRequestId, corsHeaders } from '../core/utils.js';
import { checkRateLimit, rateLimitHeaders } from '../core/rate_limit.js';
import { activeAccounts, CoupleError, fail, loadResource, mutateCouple, overview, validateDate } from '../features/couples_repository.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function matchRoute(method,path) {
  if(method==='GET' && path==='/api/couples/overview') return {kind:'overview'};
  if(method!=='POST') return null;
  if(path==='/api/couples/requests') return {kind:'createRequest'};
  let m=path.match(/^\/api\/couples\/(requests|date-proposals)\/([^/]+)\/(accept|reject|cancel)$/);
  if(m && uuid.test(m[2])) return {kind:m[1]==='requests'?'request':'proposal',id:m[2],action:m[3]};
  m=path.match(/^\/api\/couples\/([^/]+)\/(date-proposals|end)$/);
  if(m && uuid.test(m[1])) return {kind:m[2]==='end'?'relationship':'createProposal',id:m[1],action:m[2]};
  return null;
}
function trustedOrigin(request) {
  const origin=request.headers.get('Origin');
  if(!origin) return request.headers.get('Authorization')?.startsWith('Bearer ');
  // v1 Web is same-origin with the integrated Worker. No implicit dev bypass.
  return origin===new URL(request.url).origin;
}
function response(request,body,status=200,extra={}) {
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders(request),
    'Content-Type':'application/json','Cache-Control':'private, no-store','X-Request-ID':body.requestId??getRequestId(request),...extra}});
}
async function readLimitedJson(request) {
  const reader=request.body?.getReader();
  if(!reader) fail(400,'INVALID_BODY');
  const chunks=[];let length=0;
  try {
    for(;;) {
      const {done,value}=await reader.read(); if(done) break;
      length+=value.byteLength;
      if(length>16384) { await reader.cancel(); fail(400,'INVALID_BODY'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { fail(400,'INVALID_BODY'); }
}
function validateBody(body,route) {
  const fields=['operationId'];
  if(['createRequest','createProposal'].includes(route.kind)) fields.push('startedOn','timeZone');
  if(route.action==='accept') fields.push('timeZone');
  if(route.kind==='createRequest') fields.push('targetUserId');
  if(route.kind==='createProposal') fields.push('expectedVersion');
  if(!body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).some(k=>!fields.includes(k))
    || fields.some(k=>!Object.hasOwn(body,k)) || !uuid.test(body.operationId??'')) fail(400,'INVALID_BODY');
  if(route.kind==='createRequest' && (!Number.isSafeInteger(body.targetUserId)||body.targetUserId<=0)) fail(400,'INVALID_BODY');
  if(route.kind==='createProposal' && (!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)) fail(400,'INVALID_BODY');
}
function canonical(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
}
async function hashBody(route,body) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({kind:route.kind,id:route.id??null,action:route.action??null,body:canonical(body)})));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function authenticate(request,main,now) {
  const token=parseSessionId(request);
  if(!token) fail(401,'UNAUTHENTICATED');
  const row=await main.prepare(`SELECT u.id,u.lifecycle_status,s.expires_at FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.id=?`).bind(token).first();
  if(!row || row.lifecycle_status!=='active' || !(Date.parse(row.expires_at)>Date.parse(now))) fail(401,'UNAUTHENTICATED');
  return row.id;
}
const primary=db=>db.withSession?db.withSession('first-primary'):db;

export async function handleCouplesApi(request,env,url) {
  let retryHeaders={};
  try {
    const route=matchRoute(request.method,url.pathname);
    if(!route) fail(404,'NOT_FOUND');
    // Binding cutover + CD-03 friendship/lifecycle integration are required before enabling.
    if(env.ENABLE_COUPLES_API!=='true' || env.DATABASE_MODE!=='split' || !env.SOCIAL_DB || !env.DB) fail(503,'DEPENDENCY_UNAVAILABLE');
    const now=new Date().toISOString(), main=primary(env.DB), db=primary(env.SOCIAL_DB);
    const actor=await authenticate(request,main,now);
    // Bind the request to the account selected by the client, even if its
    // cookie or bearer credential changed before the UI received the update.
    if(request.headers.get('X-Expected-Account-ID')!==String(actor)) fail(409,'ACCOUNT_MISMATCH');
    if((request.method==='POST' || request.headers.has('Origin')) && !trustedOrigin(request)) fail(403,'REQUEST_ORIGIN_DENIED');
    const rate=await checkRateLimit(request,env,url);
    if(!rate.allowed) { retryHeaders=rateLimitHeaders(rate); fail(429,'RATE_LIMITED'); }
    if(route.kind==='overview') {
      const data=await overview(db,main,actor,now);
      await authenticate(request,main,new Date().toISOString());
      return response(request,{ok:true,serverNow:now,data});
    }
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??'')) fail(400,'INVALID_BODY');
    if(Number(request.headers.get('Content-Length'))>16384) fail(400,'INVALID_BODY');
    const body=await readLimitedJson(request);
    validateBody(body,route);
    if(body.targetUserId===actor) fail(409,'RELATIONSHIP_UNAVAILABLE');
    const context=await loadResource(db,route,actor);
    const partner=context?.partner??body.targetUserId;
    const authorize=async()=>{
      if(await authenticate(request,main,new Date().toISOString())!==actor) fail(401,'UNAUTHENTICATED');
      const active=await activeAccounts(main,[actor,partner]);
      const stopped=(await db.prepare('SELECT user_id FROM account_tombstones WHERE user_id=? OR user_id=?').bind(actor,partner).all()).results;
      if(!active.has(actor)) fail(401,'UNAUTHENTICATED');
      if(stopped.some(t=>t.user_id===actor)) fail(401,'UNAUTHENTICATED');
      if(route.action!=='end' && (!active.has(partner)||stopped.length)) fail(409,'RELATIONSHIP_UNAVAILABLE');
    };
    await authorize();
    const hash=await hashBody(route,body);
    const replay=async(row)=>{
      if(row.request_hash!==hash) fail(409,'OPERATION_ID_REUSED');
      await authorize();
      const result=JSON.parse(row.result_json);
      return response(request,{...result,replayed:true},row.status_code);
    };
    const previous=await db.prepare('SELECT * FROM couple_operations WHERE actor_id=? AND operation_id=?').bind(actor,body.operationId).first();
    if(previous) return await replay(previous);
    if(context && ['request','proposal'].includes(route.kind)
      && (context.row.status!=='pending' || context.row.expires_at<=now)) fail(409,'REQUEST_NOT_PENDING');
    if(['createRequest','createProposal'].includes(route.kind)) validateDate(body.startedOn,body.timeZone,now);
    if(route.action==='accept') validateDate(context.row.proposed_started_on,body.timeZone,now);
    const row=await mutateCouple(db,{route,actor,body,context,hash,now});
    if(row.wasReplay) return await replay(row);
    if(row.request_hash!==hash) fail(409,'OPERATION_ID_REUSED');
    await authorize();
    return response(request,JSON.parse(row.result_json),row.status_code);
  } catch(error) {
    const known=error instanceof CoupleError;
    const code=known?error.code:'DEPENDENCY_UNAVAILABLE', status=known?error.status:503;
    const messages={NOT_FOUND:'Resource not found',VERSION_CONFLICT:'Refresh relationship',INVALID_DATE:'Choose today or an earlier date'};
    return response(request,{ok:false,error:{code,message:messages[code]??code},requestId:getRequestId(request)},status,retryHeaders);
  }
}
