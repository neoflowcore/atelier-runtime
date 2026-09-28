import { createHash } from "node:crypto";
const SHA256=/^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("C52_SYNC_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("C52_SYNC_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function sh(v,c){if(!SHA256.test(v??""))throw new Error(c);return v}

const REQUIRED_COMPATIBILITY=Object.freeze([
 "PLAN_GRANT_TO_RUNTIME_RESOLVER",
 "AUTH_POLICY_TO_RUNTIME_ELIGIBILITY",
 "PILOTE_CONTINUATION_TO_RUNTIME_DECISION",
 "RUNTIME_DECISION_TO_PILOTE_RESPONSE_GATE",
 "PROVIDER_INTENT_TO_RUNTIME_PROVIDER_CONTROL",
 "RUNTIME_EVIDENCE_TO_PILOTE_ACCEPTANCE",
 "RUNTIME_BILLING_TO_PILOTE_COST_SAFETY",
 "NEW_CHAT_REATTACH",
 "IDENTITY_PLAN_INPUT_BINDING"
]);

export function compileCredentialIndependentCrossStackSyncV1(input={}){
 const runtimeSeal=input.runtimeSeal,piloteSeal=input.piloteSeal,runtimeHandoff=input.runtimeHandoff,piloteHandoff=input.piloteHandoff;
 if(!runtimeSeal||runtimeSeal.RUNTIME_DEVELOPMENT_SEAL!=="PASS")throw new Error("RUNTIME_REV52_SEAL_REQUIRED");
 if(!piloteSeal||piloteSeal.PILOTE_DEVELOPMENT_SEAL!=="PASS")throw new Error("PILOTE_REV52_SEAL_REQUIRED");
 if(!runtimeHandoff||runtimeHandoff.RUNTIME_HANDOFF_BUNDLE!=="SEALED")throw new Error("RUNTIME_HANDOFF_REQUIRED");
 if(!piloteHandoff||piloteHandoff.PILOTE_DEPENDENT_HANDOFF_BUNDLE!=="SEALED")throw new Error("PILOTE_HANDOFF_REQUIRED");
 const errors=[];
 if(piloteSeal.runtimeHandoffDigest!==runtimeHandoff.handoffDigest)errors.push("PILOTE_SEAL_RUNTIME_HANDOFF_MISMATCH");
 if(piloteHandoff.runtimeHandoffDigest!==runtimeHandoff.handoffDigest)errors.push("PILOTE_HANDOFF_RUNTIME_HANDOFF_MISMATCH");
 if(piloteHandoff.runtimeInterfaceDigest!==runtimeHandoff.runtimeInterfaceDigest)errors.push("RUNTIME_INTERFACE_DIGEST_MISMATCH");
 if(piloteHandoff.piloteDevelopmentSealSha256!==piloteSeal.PILOTE_DEVELOPMENT_SEAL_SHA256)errors.push("PILOTE_SEAL_HANDOFF_BINDING_MISMATCH");
 const checks=new Map((input.compatibilityChecks??[]).map(x=>[x.id,x.status]));
 for(const id of REQUIRED_COMPATIBILITY)if(checks.get(id)!=="PASS")errors.push(`COMPATIBILITY_NOT_PASS:${id}`);
 const source=input.runtimeSourceProgressDecision??{};
 if(source.PROJECT_WIDE_CREDENTIAL_INDEPENDENT_WORK_EXHAUSTED!==true)errors.push("PROJECT_WIDE_CREDENTIAL_INDEPENDENT_WORK_NOT_EXHAUSTED");
 if(source.NO_NEXT_PHASE_CREDENTIAL_INDEPENDENT_WORK!==true)errors.push("NEXT_PHASE_CREDENTIAL_INDEPENDENT_WORK_REMAINS");
 const body={SCHEMA_ID:"C52_CREDENTIAL_INDEPENDENT_CROSS_STACK_SYNC_V1",SCHEMA_VERSION:"1",runtimeDevelopmentSealSha256:sh(runtimeSeal.RUNTIME_DEVELOPMENT_SEAL_SHA256,"RUNTIME_SEAL_SHA_REQUIRED"),piloteDevelopmentSealSha256:sh(piloteSeal.PILOTE_DEVELOPMENT_SEAL_SHA256,"PILOTE_SEAL_SHA_REQUIRED"),runtimeHandoffDigest:sh(runtimeHandoff.handoffDigest,"RUNTIME_HANDOFF_DIGEST_REQUIRED"),piloteHandoffDigest:sh(piloteHandoff.handoffDigest,"PILOTE_HANDOFF_DIGEST_REQUIRED"),runtimeInterfaceDigest:sh(runtimeHandoff.runtimeInterfaceDigest,"RUNTIME_INTERFACE_DIGEST_REQUIRED"),compatibilityChecks:REQUIRED_COMPATIBILITY.map(id=>({id,status:checks.get(id)??"MISSING"})),PROJECT_WIDE_CREDENTIAL_INDEPENDENT_WORK_EXHAUSTED:source.PROJECT_WIDE_CREDENTIAL_INDEPENDENT_WORK_EXHAUSTED===true,NO_NEXT_PHASE_CREDENTIAL_INDEPENDENT_WORK:source.NO_NEXT_PHASE_CREDENTIAL_INDEPENDENT_WORK===true,errors,CROSS_STACK_COMPATIBILITY:errors.length===0?"PASS":"FAIL"};
 return Object.freeze({...body,CROSS_STACK_SYNC_SHA256:hash(body)});
}

export function validateCredentialIndependentCrossStackSyncV1(receipt){if(!receipt||receipt.SCHEMA_ID!=="C52_CREDENTIAL_INDEPENDENT_CROSS_STACK_SYNC_V1")return Object.freeze({ok:false,errors:["C52_SYNC_REQUIRED"]});const {CROSS_STACK_SYNC_SHA256,...body}=receipt;const errors=[];if(!SHA256.test(CROSS_STACK_SYNC_SHA256??"")||hash(body)!==CROSS_STACK_SYNC_SHA256)errors.push("C52_SYNC_DIGEST_MISMATCH");if(receipt.CROSS_STACK_COMPATIBILITY!=="PASS")errors.push("CROSS_STACK_COMPATIBILITY_NOT_PASS");if(receipt.PROJECT_WIDE_CREDENTIAL_INDEPENDENT_WORK_EXHAUSTED!==true||receipt.NO_NEXT_PHASE_CREDENTIAL_INDEPENDENT_WORK!==true)errors.push("SOURCE_PROGRESS_GATE_NOT_CLOSED");return Object.freeze({ok:errors.length===0,errors})}
export {REQUIRED_COMPATIBILITY as C52_REQUIRED_COMPATIBILITY_CHECKS};
