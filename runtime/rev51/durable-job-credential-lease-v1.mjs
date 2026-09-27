import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { A5_POLICY } from "./pilote-capability-resource-security-consumer-v1.mjs";

export const JOB_CREDENTIAL_LEASE_SCHEMA_ID = "DURABLE_JOB_CREDENTIAL_LEASE_V1";
export const JOB_CREDENTIAL_LEASE_SCHEMA_VERSION = "1";
export const JOB_CREDENTIAL_EVENT_SCHEMA_VERSION = "1";
export const JOB_CREDENTIAL_LEASE_STATUSES = Object.freeze(["ACTIVE", "EXPIRED", "REVOKED"]);
export const JOB_CREDENTIAL_REVOCATION_STATES = Object.freeze(["NOT_REQUIRED", "REQUIRED", "IN_PROGRESS", "OUTCOME_UNKNOWN", "REVOKED"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const SECRET_KEYS = new Set(["SECRET_VALUE", "CREDENTIAL_MATERIAL", "TOKEN", "PASSWORD", "PRIVATE_KEY", "ACCESS_TOKEN"]);
const REVOCATION_REASONS = new Set(["CANCELLED", "TERMINAL", "TRUST_RESET", "LEASE_REPLACED"]);
const STORE_KEYS = Object.freeze(["STORE_SCHEMA_ID","STATE_SCHEMA_VERSION","EVENT_SCHEMA_VERSION","CREDENTIAL_LEASE_ID","EXECUTION_ID","ATTEMPT_ID","FENCE_TOKEN","WORKER_ID","WORKER_JOB_SHA256","WORKER_READY_ATTESTATION_HASH","CREDENTIAL_REF","AUTHORITY_EVIDENCE_SHA256","LEASE_SCOPE","LEASE_STATUS","REVOCATION_STATE","SECRET_PERSISTED","ISSUED_AT_MS","EXPIRES_AT_MS","STATE_VERSION","LAST_EVENT_SEQUENCE","CREATED_AT","UPDATED_AT","ACTIVE_REVOCATION_OPERATION","IDEMPOTENCY_INDEX","EVENT_LEDGER"]);

function isObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function requireString(v,c){ if(typeof v!=="string"||!v) throw new Error(c); return v; }
function requireSha(v,c){ if(!SHA256_RE.test(v??"")) throw new Error(c); return v; }
function requireInt(v,c){ if(!Number.isSafeInteger(v)||v<0) throw new Error(c); return v; }
function iso(ms){ if(!Number.isSafeInteger(ms)||ms<0) throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED"); return new Date(ms).toISOString(); }
function canonical(v){
  if(v===null) return "null";
  if(typeof v==="string"||typeof v==="boolean") return JSON.stringify(v);
  if(typeof v==="number"){ if(!Number.isSafeInteger(v)) throw new Error("LEASE_NON_SAFE_INTEGER"); return String(v); }
  if(Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if(isObject(v)) return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  throw new Error("LEASE_UNSUPPORTED_CANONICAL_TYPE");
}
function hash(v){ return createHash("sha256").update(canonical(v),"utf8").digest("hex"); }
function exactKeys(v,expected){ if(!isObject(v)) return false; const a=Object.keys(v).sort(),b=[...expected].sort(); return a.length===b.length&&a.every((k,i)=>k===b[i]); }
function scanSecrets(v,path="$"){
  const found=[];
  if(Array.isArray(v)) v.forEach((x,i)=>found.push(...scanSecrets(x,`${path}[${i}]`)));
  else if(isObject(v)) for(const [k,x] of Object.entries(v)){ if(SECRET_KEYS.has(k.toUpperCase())) found.push(`${path}.${k}`); found.push(...scanSecrets(x,`${path}.${k}`)); }
  return found;
}
function event(prev,seq,type,key,version,ts,payload){
  const body={EVENT_SCHEMA_VERSION:JOB_CREDENTIAL_EVENT_SCHEMA_VERSION,EVENT_SEQUENCE:seq,EVENT_TYPE:type,IDEMPOTENCY_KEY:key,STATE_VERSION:version,TIMESTAMP:ts,PAYLOAD:clone(payload),PREVIOUS_EVENT_SHA256:prev};
  return {...body,EVENT_SHA256:hash(body)};
}
function validateEvents(events){
  if(!Array.isArray(events)||events.length===0) throw new Error("LEASE_EVENT_LEDGER_REQUIRED");
  let prev="0".repeat(64),seq=1;
  for(const e of events){
    if(!isObject(e)||e.EVENT_SEQUENCE!==seq||e.PREVIOUS_EVENT_SHA256!==prev) throw new Error("LEASE_EVENT_CHAIN_INVALID");
    const {EVENT_SHA256,...body}=e;
    if(!SHA256_RE.test(EVENT_SHA256??"")||hash(body)!==EVENT_SHA256) throw new Error("LEASE_EVENT_HASH_MISMATCH");
    prev=EVENT_SHA256; seq++;
  }
}
function validateStore(s){
  if(!isObject(s)) throw new Error("LEASE_STORE_REQUIRED");
  if(!exactKeys(s,STORE_KEYS)) throw new Error("LEASE_STORE_FIELDS_MISMATCH");
  if(s.STORE_SCHEMA_ID!==JOB_CREDENTIAL_LEASE_SCHEMA_ID||s.STATE_SCHEMA_VERSION!==JOB_CREDENTIAL_LEASE_SCHEMA_VERSION||s.EVENT_SCHEMA_VERSION!==JOB_CREDENTIAL_EVENT_SCHEMA_VERSION) throw new Error("LEASE_SCHEMA_MISMATCH");
  for(const [k,c] of [["CREDENTIAL_LEASE_ID","CREDENTIAL_LEASE_ID_REQUIRED"],["EXECUTION_ID","EXECUTION_ID_REQUIRED"],["ATTEMPT_ID","ATTEMPT_ID_REQUIRED"],["FENCE_TOKEN","FENCE_TOKEN_REQUIRED"],["WORKER_ID","WORKER_ID_REQUIRED"],["CREDENTIAL_REF","CREDENTIAL_REF_REQUIRED"]]) requireString(s[k],c);
  requireSha(s.WORKER_JOB_SHA256,"WORKER_JOB_SHA256_INVALID"); requireSha(s.WORKER_READY_ATTESTATION_HASH,"WORKER_READY_ATTESTATION_HASH_INVALID"); requireSha(s.AUTHORITY_EVIDENCE_SHA256,"AUTHORITY_EVIDENCE_SHA256_INVALID");
  if(s.LEASE_SCOPE!=="JOB_SCOPED") throw new Error("JOB_SCOPED_CREDENTIAL_LEASE_REQUIRED");
  if(s.SECRET_PERSISTED!==false) throw new Error("SECRET_PERSISTENCE_DENIED");
  if(!JOB_CREDENTIAL_LEASE_STATUSES.includes(s.LEASE_STATUS)) throw new Error("LEASE_STATUS_INVALID");
  if(!JOB_CREDENTIAL_REVOCATION_STATES.includes(s.REVOCATION_STATE)) throw new Error("REVOCATION_STATE_INVALID");
  requireInt(s.ISSUED_AT_MS,"ISSUED_AT_MS_INVALID"); requireInt(s.EXPIRES_AT_MS,"EXPIRES_AT_MS_INVALID"); if(s.EXPIRES_AT_MS<=s.ISSUED_AT_MS) throw new Error("LEASE_EXPIRY_INVALID");
  requireInt(s.STATE_VERSION,"LEASE_STATE_VERSION_INVALID"); requireInt(s.LAST_EVENT_SEQUENCE,"LEASE_EVENT_SEQUENCE_INVALID");
  if(!isObject(s.IDEMPOTENCY_INDEX)) throw new Error("LEASE_IDEMPOTENCY_INDEX_REQUIRED");
  if(s.ACTIVE_REVOCATION_OPERATION!==null && !exactKeys(s.ACTIVE_REVOCATION_OPERATION,["OPERATION_ID","IDEMPOTENCY_KEY"])) throw new Error("REVOCATION_OPERATION_FIELDS_MISMATCH");
  if(scanSecrets(s).length) throw new Error("SECRET_MATERIAL_FIELD_DENIED");
  validateEvents(s.EVENT_LEDGER); if(s.EVENT_LEDGER.length!==s.LAST_EVENT_SEQUENCE) throw new Error("LEASE_EVENT_SEQUENCE_MISMATCH");
  if(s.LEASE_STATUS==="REVOKED"&&s.REVOCATION_STATE!=="REVOKED") throw new Error("REVOKED_STATE_MISMATCH");
  return s;
}
async function fsyncDir(p){const h=await open(p,"r");try{await h.sync()}finally{await h.close()}}
async function atomicWrite(path,v){await mkdir(dirname(path),{recursive:true});const tmp=`${path}.tmp-${process.pid}`;const h=await open(tmp,"wx",0o600);try{await h.writeFile(`${JSON.stringify(v,null,2)}\n`,"utf8");await h.sync()}finally{await h.close()}await rename(tmp,path);await fsyncDir(dirname(path));}
async function lock(path){const lp=`${path}.lock`;try{const h=await open(lp,"wx",0o600);await h.writeFile(`${process.pid}\n`,`utf8`);await h.sync();return{lp,h}}catch(e){if(e?.code==="EEXIST")throw new Error("LEASE_STORE_LOCKED");throw e}}
async function unlock(l){try{await l.h.close()}finally{await unlink(l.lp).catch(()=>{})}}
function fingerprint(r){const c=clone(r);delete c.RUNTIME_NOW_MS;return hash(c)}

export async function readJobCredentialLeaseV1(path){ return validateStore(JSON.parse(await readFile(path,"utf8"))); }

export async function initializeJobCredentialLeaseV1(path,initial,runtimeNowMs){
  if(A5_POLICY.JOB_SCOPED_CREDENTIAL_LEASE!=="REQUIRED"||A5_POLICY.SECRET_PERSISTENCE!=="DENY") throw new Error("A5_CREDENTIAL_POLICY_NOT_BOUND");
  if(!isObject(initial)) throw new Error("LEASE_INITIAL_REQUIRED");
  if(initial.WORKER_ATTESTED!==true&&initial.PRIVILEGED_JOB_CREDENTIAL_PRESENT===true) throw new Error("UNATTESTED_WORKER_PRIVILEGED_JOB_CREDENTIAL_DENIED");
  if(initial.LEASE_SCOPE!=="JOB_SCOPED") throw new Error("JOB_SCOPED_CREDENTIAL_LEASE_REQUIRED");
  if(scanSecrets(initial).length) throw new Error("SECRET_MATERIAL_FIELD_DENIED");
  const now=requireInt(runtimeNowMs,"RUNTIME_AUTHORITATIVE_TIME_REQUIRED"), expires=requireInt(initial.EXPIRES_AT_MS,"EXPIRES_AT_MS_INVALID"); if(expires<=now) throw new Error("LEASE_ALREADY_EXPIRED");
  const ts=iso(now), id=requireString(initial.CREDENTIAL_LEASE_ID,"CREDENTIAL_LEASE_ID_REQUIRED");
  const s={STORE_SCHEMA_ID:JOB_CREDENTIAL_LEASE_SCHEMA_ID,STATE_SCHEMA_VERSION:JOB_CREDENTIAL_LEASE_SCHEMA_VERSION,EVENT_SCHEMA_VERSION:JOB_CREDENTIAL_EVENT_SCHEMA_VERSION,
    CREDENTIAL_LEASE_ID:id,EXECUTION_ID:requireString(initial.EXECUTION_ID,"EXECUTION_ID_REQUIRED"),ATTEMPT_ID:requireString(initial.ATTEMPT_ID,"ATTEMPT_ID_REQUIRED"),FENCE_TOKEN:requireString(initial.FENCE_TOKEN,"FENCE_TOKEN_REQUIRED"),WORKER_ID:requireString(initial.WORKER_ID,"WORKER_ID_REQUIRED"),
    WORKER_JOB_SHA256:requireSha(initial.WORKER_JOB_SHA256,"WORKER_JOB_SHA256_INVALID"),WORKER_READY_ATTESTATION_HASH:requireSha(initial.WORKER_READY_ATTESTATION_HASH,"WORKER_READY_ATTESTATION_HASH_INVALID"),CREDENTIAL_REF:requireString(initial.CREDENTIAL_REF,"CREDENTIAL_REF_REQUIRED"),AUTHORITY_EVIDENCE_SHA256:requireSha(initial.AUTHORITY_EVIDENCE_SHA256,"AUTHORITY_EVIDENCE_SHA256_INVALID"),
    LEASE_SCOPE:"JOB_SCOPED",LEASE_STATUS:"ACTIVE",REVOCATION_STATE:"NOT_REQUIRED",SECRET_PERSISTED:false,ISSUED_AT_MS:now,EXPIRES_AT_MS:expires,STATE_VERSION:0,LAST_EVENT_SEQUENCE:1,CREATED_AT:ts,UPDATED_AT:ts,ACTIVE_REVOCATION_OPERATION:null,IDEMPOTENCY_INDEX:{},EVENT_LEDGER:[]};
  s.EVENT_LEDGER.push(event("0".repeat(64),1,"JOB_CREDENTIAL_LEASE_INITIALIZED",`init:${id}`,0,ts,{CREDENTIAL_LEASE_ID:id,WORKER_JOB_SHA256:s.WORKER_JOB_SHA256})); validateStore(s);
  const l=await lock(path);try{try{await readFile(path,"utf8");throw new Error("LEASE_STORE_ALREADY_EXISTS")}catch(e){if(e?.code!=="ENOENT")throw e}await atomicWrite(path,s)}finally{await unlock(l)} return clone(s);
}

async function cas(path,request,mutate){
  if(!isObject(request)) throw new Error("LEASE_CAS_REQUEST_REQUIRED"); const key=requireString(request.IDEMPOTENCY_KEY,"IDEMPOTENCY_KEY_REQUIRED"),ts=iso(request.RUNTIME_NOW_MS),fp=fingerprint(request),l=await lock(path);
  try{const cur=await readJobCredentialLeaseV1(path),prior=cur.IDEMPOTENCY_INDEX[key];if(prior){if(prior.REQUEST_SHA256!==fp)throw new Error("IDEMPOTENCY_KEY_CONFLICT");return{ok:true,replay:true,state:clone(cur)}}
    if(request.EXPECTED_STATE_VERSION!==cur.STATE_VERSION) throw new Error("LEASE_STATE_CAS_MISMATCH"); const next=clone(cur);mutate(next,cur);next.STATE_VERSION=cur.STATE_VERSION+1;next.UPDATED_AT=ts;const seq=cur.LAST_EVENT_SEQUENCE+1;next.EVENT_LEDGER.push(event(cur.EVENT_LEDGER.at(-1).EVENT_SHA256,seq,request.EVENT_TYPE,key,next.STATE_VERSION,ts,request.EVENT_PAYLOAD??{}));next.LAST_EVENT_SEQUENCE=seq;next.IDEMPOTENCY_INDEX[key]={REQUEST_SHA256:fp,EVENT_SEQUENCE:seq,STATE_VERSION:next.STATE_VERSION};validateStore(next);await atomicWrite(path,next);return{ok:true,replay:false,state:clone(next)}}finally{await unlock(l)}
}

export function validateJobCredentialUseV1(store,request,runtimeNowMs){
  try{validateStore(store);if(store.LEASE_STATUS!=="ACTIVE")throw new Error("CREDENTIAL_LEASE_NOT_ACTIVE");if(store.REVOCATION_STATE!=="NOT_REQUIRED")throw new Error("CREDENTIAL_LEASE_REVOCATION_PENDING");if(runtimeNowMs>=store.EXPIRES_AT_MS)throw new Error("CREDENTIAL_LEASE_EXPIRED");if(request.EXECUTION_ID!==store.EXECUTION_ID)throw new Error("LEASE_EXECUTION_BINDING_MISMATCH");if(request.ATTEMPT_ID!==store.ATTEMPT_ID)throw new Error("LEASE_ATTEMPT_BINDING_MISMATCH");if(request.FENCE_TOKEN!==store.FENCE_TOKEN)throw new Error("STALE_FENCE_REJECTED");if(request.WORKER_ID!==store.WORKER_ID)throw new Error("LEASE_WORKER_BINDING_MISMATCH");if(request.WORKER_JOB_SHA256!==store.WORKER_JOB_SHA256)throw new Error("LEASE_WORKER_JOB_BINDING_MISMATCH");if(request.WORKER_READY_ATTESTATION_HASH!==store.WORKER_READY_ATTESTATION_HASH)throw new Error("LEASE_ATTESTATION_BINDING_MISMATCH");return{ok:true,code:"JOB_CREDENTIAL_USE_ALLOWED"}}catch(e){return{ok:false,code:e.message}}
}

export async function reconcileJobCredentialLeaseExpiryV1(path,request){return cas(path,{...request,EVENT_TYPE:"JOB_CREDENTIAL_LEASE_EXPIRED",EVENT_PAYLOAD:{}},(next,cur)=>{if(request.RUNTIME_NOW_MS<cur.EXPIRES_AT_MS)throw new Error("LEASE_STILL_VALID");if(cur.LEASE_STATUS==="REVOKED")throw new Error("LEASE_ALREADY_REVOKED");next.LEASE_STATUS="EXPIRED";next.REVOCATION_STATE=cur.REVOCATION_STATE==="REVOKED"?"REVOKED":"REQUIRED";});}

export async function requireJobCredentialRevocationV1(path,request){const reason=request?.REASON??"TERMINAL";if(!REVOCATION_REASONS.has(reason))throw new Error("REVOCATION_REASON_INVALID");return cas(path,{...request,REASON:reason,EVENT_TYPE:"JOB_CREDENTIAL_REVOCATION_REQUIRED",EVENT_PAYLOAD:{REASON:reason}},(next,cur)=>{if(cur.LEASE_STATUS==="REVOKED")throw new Error("LEASE_ALREADY_REVOKED");next.REVOCATION_STATE="REQUIRED";});}

export async function beginJobCredentialRevocationV1(path,request){return cas(path,{...request,EVENT_TYPE:"JOB_CREDENTIAL_REVOCATION_STARTED",EVENT_PAYLOAD:{OPERATION_ID:request.OPERATION_ID}},(next,cur)=>{if(!["REQUIRED","OUTCOME_UNKNOWN"].includes(cur.REVOCATION_STATE))throw new Error("REVOCATION_NOT_REQUIRED");if(cur.REVOCATION_STATE==="OUTCOME_UNKNOWN"&&(cur.ACTIVE_REVOCATION_OPERATION?.OPERATION_ID!==request.OPERATION_ID||cur.ACTIVE_REVOCATION_OPERATION?.IDEMPOTENCY_KEY!==request.OPERATION_IDEMPOTENCY_KEY))throw new Error("SECOND_MUTATION_DENIED");next.REVOCATION_STATE="IN_PROGRESS";next.ACTIVE_REVOCATION_OPERATION={OPERATION_ID:requireString(request.OPERATION_ID,"OPERATION_ID_REQUIRED"),IDEMPOTENCY_KEY:requireString(request.OPERATION_IDEMPOTENCY_KEY,"OPERATION_IDEMPOTENCY_KEY_REQUIRED")};});}

export async function recordJobCredentialRevocationOutcomeV1(path,request){return cas(path,{...request,EVENT_TYPE:"JOB_CREDENTIAL_REVOCATION_OUTCOME",EVENT_PAYLOAD:{RESULT:request.RESULT,OPERATION_ID:request.OPERATION_ID}},(next,cur)=>{const op=cur.ACTIVE_REVOCATION_OPERATION;if(!op||op.OPERATION_ID!==request.OPERATION_ID||op.IDEMPOTENCY_KEY!==request.OPERATION_IDEMPOTENCY_KEY)throw new Error("REVOCATION_OPERATION_BINDING_MISMATCH");if(request.RESULT==="PASS"){next.REVOCATION_STATE="REVOKED";next.LEASE_STATUS="REVOKED";next.ACTIVE_REVOCATION_OPERATION=null;}else if(request.RESULT==="OUTCOME_UNKNOWN"){next.REVOCATION_STATE="OUTCOME_UNKNOWN";}else throw new Error("REVOCATION_RESULT_INVALID");});}

export function validateJobCredentialLeaseV1(store){try{validateStore(store);return{ok:true,errors:[]}}catch(e){return{ok:false,errors:[e.message]}}}
