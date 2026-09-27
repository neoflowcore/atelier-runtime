import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export const PROVIDER_CAPABILITY_REGISTRY_SCHEMA_ID = "PROVIDER_CAPABILITY_REGISTRY_V1";
export const PROVIDER_CAPABILITY_PROFILE_SCHEMA_ID = "PROVIDER_CAPABILITY_PROFILE_V1";
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const TOKEN = /^[A-Z][A-Z0-9_.-]{0,63}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function clone(v){return JSON.parse(JSON.stringify(v))}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("PROVIDER_REGISTRY_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("PROVIDER_REGISTRY_UNSUPPORTED_CANONICAL_TYPE")}
function hash(v){return createHash("sha256").update(canon(v),"utf8").digest("hex")}
function str(v,c,re=ID){if(typeof v!=="string"||!re.test(v))throw new Error(c);return v}
function iso(ms){if(!Number.isSafeInteger(ms)||ms<0)throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED");return new Date(ms).toISOString()}
function sorted(v,c,re=TOKEN){if(!Array.isArray(v)||v.some(x=>typeof x!=="string"||!re.test(x)))throw new Error(c);const s=[...new Set(v)].sort();if(s.length!==v.length)throw new Error(`${c}_DUPLICATE`);return s}
function validateProfile(p){
  if(!obj(p)||p.SCHEMA_ID!==PROVIDER_CAPABILITY_PROFILE_SCHEMA_ID||p.SCHEMA_VERSION!=="1")throw new Error("PROVIDER_CAPABILITY_PROFILE_SCHEMA_MISMATCH");
  str(p.PROVIDER_ID,"PROVIDER_ID_INVALID");
  if(!["READY","BOOTSTRAP_REQUIRED","UNAVAILABLE"].includes(p.EXECUTION_ADAPTER_STATE))throw new Error("PROVIDER_EXECUTION_ADAPTER_STATE_INVALID");
  if(!["HEALTHY","DEGRADED","QUARANTINED","UNKNOWN"].includes(p.HEALTH_STATE))throw new Error("PROVIDER_HEALTH_STATE_INVALID");
  if(!["FREE","METERED","PAID"].includes(p.COST_CLASS))throw new Error("PROVIDER_COST_CLASS_INVALID");
  sorted(p.CAPABILITIES,"PROVIDER_CAPABILITIES_INVALID");
  sorted(p.OS_CLASSES,"PROVIDER_OS_CLASSES_INVALID");
  sorted(p.ARCH_CLASSES,"PROVIDER_ARCH_CLASSES_INVALID");
  sorted(p.WORKSPACE_CLASSES,"PROVIDER_WORKSPACE_CLASSES_INVALID");
  sorted(p.NETWORK_CLASSES,"PROVIDER_NETWORK_CLASSES_INVALID");
  sorted(p.DATA_ACCESS_CLASSES,"PROVIDER_DATA_ACCESS_CLASSES_INVALID");
  sorted(p.SECRET_CLASSES,"PROVIDER_SECRET_CLASSES_INVALID");
  sorted(p.RUNTIME_FINGERPRINTS,"PROVIDER_RUNTIME_FINGERPRINTS_INVALID",/^[A-Za-z0-9][A-Za-z0-9@.+:_/-]{0,127}$/);
  sorted(p.PACKAGE_MANAGER_FINGERPRINTS,"PROVIDER_PACKAGE_MANAGER_FINGERPRINTS_INVALID",/^[A-Za-z0-9][A-Za-z0-9@.+:_/-]{0,127}$/);
  sorted(p.REGISTRIES,"PROVIDER_REGISTRIES_INVALID",/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/);
  if(!Number.isSafeInteger(p.AVAILABLE_DISK_MIB)||p.AVAILABLE_DISK_MIB<0||!Number.isSafeInteger(p.AVAILABLE_MEMORY_MIB)||p.AVAILABLE_MEMORY_MIB<0)throw new Error("PROVIDER_CAPACITY_INVALID");
  const observed=Date.parse(p.OBSERVED_AT??""),validUntil=Date.parse(p.VALID_UNTIL??"");if(!Number.isFinite(observed)||!Number.isFinite(validUntil)||validUntil<=observed)throw new Error("PROVIDER_PROFILE_FRESHNESS_INVALID");
  if(!SHA.test(p.PROFILE_SHA256??""))throw new Error("PROVIDER_PROFILE_SHA256_INVALID");const{PROFILE_SHA256,...body}=p;if(hash(body)!==p.PROFILE_SHA256)throw new Error("PROVIDER_PROFILE_SHA256_MISMATCH");return p;
}
export function createProviderCapabilityProfileV1(input){
  if(!obj(input))throw new Error("PROVIDER_CAPABILITY_PROFILE_INPUT_REQUIRED");
  const body={SCHEMA_ID:PROVIDER_CAPABILITY_PROFILE_SCHEMA_ID,SCHEMA_VERSION:"1",PROVIDER_ID:str(input.PROVIDER_ID,"PROVIDER_ID_INVALID"),EXECUTION_ADAPTER_STATE:input.EXECUTION_ADAPTER_STATE,HEALTH_STATE:input.HEALTH_STATE,COST_CLASS:input.COST_CLASS,CAPABILITIES:sorted(input.CAPABILITIES??[],"PROVIDER_CAPABILITIES_INVALID"),OS_CLASSES:sorted(input.OS_CLASSES??[],"PROVIDER_OS_CLASSES_INVALID"),ARCH_CLASSES:sorted(input.ARCH_CLASSES??[],"PROVIDER_ARCH_CLASSES_INVALID"),WORKSPACE_CLASSES:sorted(input.WORKSPACE_CLASSES??[],"PROVIDER_WORKSPACE_CLASSES_INVALID"),NETWORK_CLASSES:sorted(input.NETWORK_CLASSES??[],"PROVIDER_NETWORK_CLASSES_INVALID"),DATA_ACCESS_CLASSES:sorted(input.DATA_ACCESS_CLASSES??[],"PROVIDER_DATA_ACCESS_CLASSES_INVALID"),SECRET_CLASSES:sorted(input.SECRET_CLASSES??[],"PROVIDER_SECRET_CLASSES_INVALID"),RUNTIME_FINGERPRINTS:sorted(input.RUNTIME_FINGERPRINTS??[],"PROVIDER_RUNTIME_FINGERPRINTS_INVALID",/^[A-Za-z0-9][A-Za-z0-9@.+:_/-]{0,127}$/),PACKAGE_MANAGER_FINGERPRINTS:sorted(input.PACKAGE_MANAGER_FINGERPRINTS??[],"PROVIDER_PACKAGE_MANAGER_FINGERPRINTS_INVALID",/^[A-Za-z0-9][A-Za-z0-9@.+:_/-]{0,127}$/),REGISTRIES:sorted(input.REGISTRIES??[],"PROVIDER_REGISTRIES_INVALID",/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/),AVAILABLE_DISK_MIB:input.AVAILABLE_DISK_MIB,AVAILABLE_MEMORY_MIB:input.AVAILABLE_MEMORY_MIB,OBSERVED_AT:input.OBSERVED_AT,VALID_UNTIL:input.VALID_UNTIL};
  for(const k of ["EXECUTION_ADAPTER_STATE","HEALTH_STATE","COST_CLASS"])if(typeof body[k]!=="string")throw new Error(`PROVIDER_${k}_INVALID`);for(const k of ["AVAILABLE_DISK_MIB","AVAILABLE_MEMORY_MIB"])if(!Number.isSafeInteger(body[k])||body[k]<0)throw new Error(`PROVIDER_${k}_INVALID`);const p={...body,PROFILE_SHA256:hash(body)};validateProfile(p);return Object.freeze(p);
}
function validateStore(s){if(!obj(s)||s.SCHEMA_ID!==PROVIDER_CAPABILITY_REGISTRY_SCHEMA_ID||s.SCHEMA_VERSION!=="1")throw new Error("PROVIDER_REGISTRY_SCHEMA_MISMATCH");str(s.REGISTRY_ID,"PROVIDER_REGISTRY_ID_INVALID");if(!Number.isSafeInteger(s.STATE_VERSION)||s.STATE_VERSION<0||!obj(s.PROFILES)||!obj(s.IDEMPOTENCY_INDEX))throw new Error("PROVIDER_REGISTRY_STATE_INVALID");for(const [id,p] of Object.entries(s.PROFILES)){if(id!==p.PROVIDER_ID)throw new Error("PROVIDER_REGISTRY_PROFILE_KEY_MISMATCH");validateProfile(p)}return s}
async function syncDir(p){const h=await open(p,"r");try{await h.sync()}finally{await h.close()}}
async function write(p,v){await mkdir(dirname(p),{recursive:true});const t=`${p}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;const h=await open(t,"wx",0o600);try{await h.writeFile(`${JSON.stringify(v,null,2)}\n`);await h.sync()}finally{await h.close()}try{await rename(t,p);await syncDir(dirname(p))}catch(e){await unlink(t).catch(()=>{});throw e}}
async function lock(p){try{return await open(`${p}.lock`,"wx",0o600)}catch(e){if(e?.code==="EEXIST")throw new Error("PROVIDER_REGISTRY_LOCKED");throw e}}
async function unlock(p,h){try{await h.close()}finally{await unlink(`${p}.lock`).catch(()=>{})}}
export async function initializeProviderCapabilityRegistryV1(path,input,runtimeNowMs){const s={SCHEMA_ID:PROVIDER_CAPABILITY_REGISTRY_SCHEMA_ID,SCHEMA_VERSION:"1",REGISTRY_ID:str(input?.REGISTRY_ID,"PROVIDER_REGISTRY_ID_INVALID"),STATE_VERSION:0,PROFILES:{},IDEMPOTENCY_INDEX:{},CREATED_AT:iso(runtimeNowMs),UPDATED_AT:iso(runtimeNowMs)},h=await lock(path);try{try{await readFile(path);throw new Error("PROVIDER_REGISTRY_ALREADY_EXISTS")}catch(e){if(e?.code!=="ENOENT")throw e}validateStore(s);await write(path,s);return clone(s)}finally{await unlock(path,h)}}
export async function readProviderCapabilityRegistryV1(path){return clone(validateStore(JSON.parse(await readFile(path,"utf8"))))}
export async function upsertProviderCapabilityProfileV1(path,profile,request){validateProfile(profile);const key=str(request?.IDEMPOTENCY_KEY,"IDEMPOTENCY_KEY_INVALID",/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),fp=hash({KEY:key,PROFILE_SHA256:profile.PROFILE_SHA256}),h=await lock(path);try{const cur=await readProviderCapabilityRegistryV1(path),prior=cur.IDEMPOTENCY_INDEX[key];if(prior){if(prior.REQUEST_SHA256!==fp)throw new Error("PROVIDER_REGISTRY_IDEMPOTENCY_CONFLICT");return{ok:true,replay:true,state:cur}}if(request.EXPECTED_STATE_VERSION!==cur.STATE_VERSION)throw new Error("PROVIDER_REGISTRY_STATE_CAS_MISMATCH");const next=clone(cur);next.PROFILES[profile.PROVIDER_ID]=clone(profile);next.STATE_VERSION++;next.UPDATED_AT=iso(request.RUNTIME_NOW_MS);next.IDEMPOTENCY_INDEX[key]={REQUEST_SHA256:fp,STATE_VERSION:next.STATE_VERSION};validateStore(next);await write(path,next);return{ok:true,replay:false,state:clone(next)}}finally{await unlock(path,h)}}
export function resolveCurrentProviderCapabilityProfileV1(registry,providerId,runtimeNowMs){validateStore(clone(registry));if(!Number.isSafeInteger(runtimeNowMs))return{ok:false,code:"RUNTIME_AUTHORITATIVE_TIME_REQUIRED",profile:null};const p=registry.PROFILES[providerId];if(!p)return{ok:false,code:"PROVIDER_PROFILE_NOT_FOUND",profile:null};if(Date.parse(p.VALID_UNTIL)<=runtimeNowMs)return{ok:false,code:"PROVIDER_PROFILE_STALE",profile:clone(p)};return{ok:true,code:"PROVIDER_PROFILE_CURRENT",profile:clone(p)}}
export function computeProviderCapabilityObjectSha256V1(value){return hash(value)}
