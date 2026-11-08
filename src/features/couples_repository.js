import { acceptCoupleStatements } from './couple_transactions.js';

export class CoupleError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new CoupleError(status, code); };
export const requestView = q => ({id:q.id,requesterUserId:q.requester_id,recipientUserId:q.recipient_id,
  startedOn:q.proposed_started_on,status:q.status,createdAt:q.created_at,expiresAt:q.expires_at,relationshipId:q.relationship_id});
export const proposalView = q => ({id:q.id,relationshipId:q.relationship_id,requesterUserId:q.requester_id,
  startedOn:q.proposed_started_on,baseVersion:q.base_version,status:q.status,createdAt:q.created_at,expiresAt:q.expires_at});
export const relationshipView = (r, actor) => ({id:r.id,partnerUserId:r.user_a_id===actor?r.user_b_id:r.user_a_id,
  startedOn:r.started_on,status:r.status,version:r.version,updatedAt:r.updated_at,endedAt:r.ended_at});

export function validateDate(startedOn, timeZone, now) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) fail(422,'INVALID_TIME_ZONE');
  let parts;
  try { parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)); }
  catch { fail(422,'INVALID_TIME_ZONE'); }
  const get=k=>parts.find(p=>p.type===k).value;
  const today=`${get('year')}-${get('month')}-${get('day')}`;
  if(typeof startedOn!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(startedOn) || startedOn<'1900-01-01'
    || !Number.isFinite(Date.parse(startedOn)) || new Date(startedOn).toISOString().slice(0,10)!==startedOn || startedOn>today) fail(422,'INVALID_DATE');
}

export async function activeAccounts(main, ids) {
  const unique=[...new Set(ids)];
  const active=new Set();
  for(let i=0;i<unique.length;i+=50) {
    const chunk=unique.slice(i,i+50);
    const rows=await main.prepare(`SELECT id FROM users WHERE id IN (${chunk.map(()=>'?').join(',')}) AND lifecycle_status='active'`).bind(...chunk).all();
    for(const r of rows.results) active.add(r.id);
  }
  return active;
}

export async function loadResource(db, route, actor) {
  if(!route.id) return null;
  if(route.kind==='request') {
    const q=await db.prepare('SELECT * FROM couple_requests WHERE id=?').bind(route.id).first();
    if(!q || ![q.requester_id,q.recipient_id].includes(actor)
      || (route.action==='cancel'?q.requester_id!==actor:q.recipient_id!==actor)) fail(404,'NOT_FOUND');
    return {row:q,partner:q.requester_id===actor?q.recipient_id:q.requester_id};
  }
  const q=route.kind==='proposal'?await db.prepare('SELECT * FROM couple_date_proposals WHERE id=?').bind(route.id).first():null;
  const r=await db.prepare('SELECT * FROM couple_relationships WHERE id=?').bind(q?.relationship_id??route.id).first();
  if(!r || ![r.user_a_id,r.user_b_id].includes(actor) || (route.kind==='proposal' && (!q ||
    (route.action==='cancel'?q.requester_id!==actor:q.requester_id===actor)))) fail(404,'NOT_FOUND');
  return {row:route.kind==='proposal'?q:r,relationship:r,partner:r.user_a_id===actor?r.user_b_id:r.user_a_id};
}

export async function overview(db, main, actor, now) {
  const r=await db.prepare(`SELECT r.* FROM couple_relationships r JOIN couple_active_members m ON m.relationship_id=r.id
    WHERE m.user_id=? AND r.status='active'`).bind(actor).first();
  const qs=(await db.prepare(`SELECT * FROM couple_requests WHERE (requester_id=? OR recipient_id=?)
    AND status='pending' AND expires_at>? ORDER BY created_at,id`).bind(actor,actor,now).all()).results;
  const ids=[actor,...qs.flatMap(q=>[q.requester_id,q.recipient_id]),...(r?[r.user_a_id,r.user_b_id]:[])];
  const active=await activeAccounts(main,ids);
  const stopped=new Set(), unique=[...new Set(ids)];
  for(let i=0;i<unique.length;i+=50) {
    const chunk=unique.slice(i,i+50);
    const rows=await db.prepare(`SELECT user_id FROM account_tombstones WHERE user_id IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all();
    for(const t of rows.results) stopped.add(t.user_id);
  }
  const allowed=id=>active.has(id)&&!stopped.has(id);
  let relationship=null, dateProposal=null;
  if(r && allowed(r.user_a_id)&&allowed(r.user_b_id)) {
    const a=r.user_a_id,b=r.user_b_id;
    const friend=await db.prepare(`SELECT 1 FROM friendships WHERE user_one_id=? AND user_two_id=?
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?))`)
      .bind(a,b,a,b,b,a).first();
    if(friend) {
      relationship=relationshipView(r,actor);
      const partner=await main.prepare('SELECT name FROM users WHERE id=?').bind(relationship.partnerUserId).first();
      if(typeof partner?.name==='string') relationship.partnerName=[...partner.name.replace(/[\u0000-\u001f\u007f]/g,' ').trim()].slice(0,80).join('') || null;
      const q=await db.prepare(`SELECT * FROM couple_date_proposals WHERE relationship_id=? AND status='pending' AND expires_at>?`).bind(r.id,now).first();
      if(q) dateProposal=proposalView(q);
    }
  }
  // Check main-account authority again after the social reads, before returning private data.
  const current=await activeAccounts(main,ids);
  if(relationship && (!current.has(actor)||!current.has(relationship.partnerUserId))) {relationship=null;dateProposal=null;}
  const pending=qs.filter(q=>allowed(q.requester_id)&&allowed(q.recipient_id)&&current.has(q.requester_id)&&current.has(q.recipient_id));
  return {relationship,incomingRequests:pending.filter(q=>q.recipient_id===actor).map(requestView),
    outgoingRequests:pending.filter(q=>q.requester_id===actor).map(requestView),dateProposal};
}

// Every state-dependent predicate below runs inside the write batch, including zero-row guards.
export async function mutateCouple(db, {route, actor, body, context, hash, now}) {
  const op=body.operationId, id=crypto.randomUUID(), expiry=new Date(Date.parse(now)+604800000).toISOString();
  const p=(sql,...args)=>db.prepare(sql).bind(...args);
  const statements=[];
  const guard=(condition,args=[],code='REQUEST_NOT_PENDING')=>{
    statements.push(p(`INSERT INTO couple_write_guards VALUES(?,CASE WHEN (${condition}) THEN 1 ELSE 0 END)`,`${actor}:${op}:${statements.length}`, ...args));
    errorCode=code;
  };
  let errorCode='REQUEST_NOT_PENDING', resultSelect, statusSelect='200';
  const partner=context?.partner??body.targetUserId;
  const a=Math.min(actor,partner), b=Math.max(actor,partner);
  const eligible=`EXISTS(SELECT 1 FROM friendships WHERE user_one_id=${a} AND user_two_id=${b})
    AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_user_id=${a} AND blocked_user_id=${b}) OR (blocker_user_id=${b} AND blocked_user_id=${a}))
    AND NOT EXISTS(SELECT 1 FROM account_tombstones WHERE user_id IN (${a},${b}))`;
  // a/b are validated positive safe integers, never arbitrary SQL input.
  const relSql=where=>`SELECT json_object('id',id,'partnerUserId',CASE WHEN user_a_id=${actor} THEN user_b_id ELSE user_a_id END,
    'startedOn',started_on,'status',status,'version',version,'updatedAt',updated_at,'endedAt',ended_at) FROM couple_relationships WHERE ${where}`;
  const reqSql=where=>`SELECT json_object('id',id,'requesterUserId',requester_id,'recipientUserId',recipient_id,'startedOn',proposed_started_on,
    'status',status,'createdAt',created_at,'expiresAt',expires_at,'relationshipId',relationship_id) FROM couple_requests WHERE ${where}`;
  const propSql=where=>`SELECT json_object('id',id,'relationshipId',relationship_id,'requesterUserId',requester_id,'startedOn',proposed_started_on,
    'baseVersion',base_version,'status',status,'createdAt',created_at,'expiresAt',expires_at) FROM couple_date_proposals WHERE ${where}`;
  // These IDs are generated UUIDs or route-validated UUIDs.
  const key=`'${route.id??id}'`;
  if(route.kind==='createRequest') {
    guard(`${eligible} AND NOT EXISTS(SELECT 1 FROM couple_active_members WHERE user_id IN (${a},${b}))`,[],'RELATIONSHIP_UNAVAILABLE');
    statements.push(p(`UPDATE couple_requests SET status='expired',responded_at=? WHERE user_a_id=? AND user_b_id=? AND status='pending' AND expires_at<=?`,now,a,b,now));
    statements.push(p(`INSERT INTO couple_requests(id,user_a_id,user_b_id,requester_id,recipient_id,proposed_started_on,status,created_at,expires_at)
      SELECT ?,?,?,?,?,?,'pending',?,? WHERE NOT EXISTS(SELECT 1 FROM couple_requests WHERE user_a_id=? AND user_b_id=? AND status='pending')`,id,a,b,actor,partner,body.startedOn,now,expiry,a,b));
    const where=`user_a_id=${a} AND user_b_id=${b} AND status='pending'`;
    resultSelect=`json_object('request',json((${reqSql(where)})))`;
    statusSelect=`CASE WHEN EXISTS(SELECT 1 FROM couple_requests WHERE id='${id}') THEN 201 ELSE 200 END`;
  } else if(route.kind==='request') {
    guard(`EXISTS(SELECT 1 FROM couple_requests WHERE id=? AND status='pending' AND expires_at>?)`,[route.id,now]);
    if(route.action==='accept') {
      // CD-01 builder enforces eligibility/membership and consumes the request atomically.
      statements.push(...acceptCoupleStatements(db,{requestId:route.id,actorId:actor,relationshipId:id,operationId:op,requestHash:hash,now}).slice(0,-2));
      resultSelect=`json_object('relationship',json((${relSql(`id='${id}'`)})))`;
      errorCode='RELATIONSHIP_UNAVAILABLE';
    } else {
      statements.push(p(`UPDATE couple_requests SET status=?,responded_at=? WHERE id=?`,route.action==='cancel'?'cancelled':'declined',now,route.id));
      resultSelect=`json_object('request',json((${reqSql(`id=${key}`)})))`;
    }
  } else {
    const rid=context.relationship.id;
    guard(`EXISTS(SELECT 1 FROM couple_relationships WHERE id=? AND status='active')`,[rid],'VERSION_CONFLICT');
    if(route.action!=='end') guard(eligible,[],'RELATIONSHIP_UNAVAILABLE');
    if(route.kind==='createProposal') {
      guard(`EXISTS(SELECT 1 FROM couple_relationships WHERE id=? AND version=?)`,[rid,body.expectedVersion],'VERSION_CONFLICT');
      statements.push(p(`UPDATE couple_date_proposals SET status='expired',responded_at=? WHERE relationship_id=? AND status='pending' AND expires_at<=?`,now,rid,now));
      guard(`NOT EXISTS(SELECT 1 FROM couple_date_proposals WHERE relationship_id=? AND status='pending')`,[rid],'VERSION_CONFLICT');
      statements.push(p(`INSERT INTO couple_date_proposals VALUES(?,?,?,?,?,'pending',?,?,NULL)`,id,rid,actor,body.startedOn,body.expectedVersion,now,expiry));
      resultSelect=`json_object('proposal',json((${propSql(`id='${id}'`)})))`; statusSelect='201';
    } else if(route.kind==='proposal') {
      guard(`EXISTS(SELECT 1 FROM couple_date_proposals WHERE id=? AND status='pending' AND expires_at>?)`,[route.id,now]);
      if(route.action==='accept') {
        guard(`EXISTS(SELECT 1 FROM couple_relationships r JOIN couple_date_proposals q ON r.id=q.relationship_id WHERE q.id=? AND r.version=q.base_version)`,[route.id],'VERSION_CONFLICT');
        statements.push(p(`UPDATE couple_relationships SET started_on=(SELECT proposed_started_on FROM couple_date_proposals WHERE id=?),version=version+1,updated_at=? WHERE id=?`,route.id,now,rid));
        statements.push(p(`INSERT INTO couple_audit VALUES(?,?,?,'date_changed',?)`,`${actor}:${op}`,rid,actor,now));
      }
      statements.push(p(`UPDATE couple_date_proposals SET status=?,responded_at=? WHERE id=?`,{accept:'accepted',reject:'declined',cancel:'cancelled'}[route.action],now,route.id));
      resultSelect=`json_object('proposal',json((${propSql(`id=${key}`)}))${route.action==='accept'?`, 'relationship',json((${relSql(`id='${rid}'`)}))`:''})`;
    } else {
      statements.push(p(`UPDATE couple_relationships SET status='ended',version=version+1,updated_at=?,ended_at=?,ended_reason='unbound' WHERE id=?`,now,now,rid));
      statements.push(p(`DELETE FROM couple_active_members WHERE relationship_id=?`,rid));
      statements.push(p(`UPDATE couple_date_proposals SET status='invalidated',responded_at=? WHERE relationship_id=? AND status='pending'`,now,rid));
      statements.push(p(`UPDATE couple_requests SET status='invalidated',responded_at=? WHERE user_a_id=? AND user_b_id=? AND status='pending'`,now,a,b));
      statements.push(p(`INSERT INTO couple_audit VALUES(?,?,?,'ended',?)`,`${actor}:${op}`,rid,actor,now));
      resultSelect=`json_object('relationship',json((${relSql(`id='${rid}'`)})))`;
    }
  }
  statements.push(p(`INSERT INTO couple_operations SELECT ?,?,?,json_object('ok',json('true'),'serverNow',?,'data',${resultSelect}),${statusSelect},?`,actor,op,hash,now,now));
  // Guards are transient; remove only keys owned by this batch, including the CD-01 key.
  statements.push(p(`DELETE FROM couple_write_guards WHERE operation_id=? OR operation_id LIKE ?`,op,`${actor}:${op}:%`));
  statements.push(p('SELECT * FROM couple_operations WHERE actor_id=? AND operation_id=?',actor,op));
  try { const results=await db.batch(statements); return results.at(-1).results[0]; }
  catch(error) {
    const replay=await db.prepare('SELECT * FROM couple_operations WHERE actor_id=? AND operation_id=?').bind(actor,op).first();
    if(replay) return {...replay,wasReplay:true};
    if(/constraint|UNIQUE|CHECK|FOREIGN KEY/i.test(error.message)) fail(409,errorCode);
    throw error;
  }
}
