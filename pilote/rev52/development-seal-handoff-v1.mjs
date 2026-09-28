import { createHash } from "node:crypto";

const SHA256_RE=/^[0-9a-f]{64}$/;
const SHA40_RE=/^[0-9a-f]{40}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P52_D6_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P52_D6_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function sha(v,c){if(!SHA256_RE.test(v??""))throw new Error(c);return v}
function sha40(v,c){if(!SHA40_RE.test(v??""))throw new Error(c);return v}
function pass(v,c){if(v!=="PASS")throw new Error(c);return v}

export function compilePiloteDevelopmentSealV1(input={}){
  const body={
    SCHEMA_ID:"PILOTE_REV52_DEVELOPMENT_SEAL_V1",
    SCHEMA_VERSION:"1",
    PILOTE_REV5_2:"SEALED",
    piloteSourceHead:sha40(input.piloteSourceHead,"PILOTE_SOURCE_HEAD_REQUIRED"),
    piloteSourceTree:sha40(input.piloteSourceTree,"PILOTE_SOURCE_TREE_REQUIRED"),
    canonicalRunId:Number.isSafeInteger(input.canonicalRunId)&&input.canonicalRunId>0?input.canonicalRunId:(()=>{throw new Error("CANONICAL_RUN_ID_REQUIRED")})(),
    runtimeDependencyLockSha256:sha(input.runtimeDependencyLockSha256,"RUNTIME_DEPENDENCY_LOCK_SHA256_REQUIRED"),
    runtimeHandoffDigest:sha(input.runtimeHandoffDigest,"RUNTIME_HANDOFF_DIGEST_REQUIRED"),
    runtimeInterfaceDigest:sha(input.runtimeInterfaceDigest,"RUNTIME_INTERFACE_DIGEST_REQUIRED"),
    dependentConformanceSha256:sha(input.dependentConformanceSha256,"DEPENDENT_CONFORMANCE_SHA256_REQUIRED"),
    D0_RUNTIME_HANDOFF_BIND:pass(input.D0_RUNTIME_HANDOFF_BIND,"D0_PASS_REQUIRED"),
    D1_PLAN_GRANT_SOURCE_PROGRESS:pass(input.D1_PLAN_GRANT_SOURCE_PROGRESS,"D1_PASS_REQUIRED"),
    D2_AUTH_AUTHORITY_COMPILER:pass(input.D2_AUTH_AUTHORITY_COMPILER,"D2_PASS_REQUIRED"),
    D3_CONTINUATION_RESPONSE_GATE:pass(input.D3_CONTINUATION_RESPONSE_GATE,"D3_PASS_REQUIRED"),
    D4_PROVIDER_EVIDENCE_INTENT:pass(input.D4_PROVIDER_EVIDENCE_INTENT,"D4_PASS_REQUIRED"),
    D5_DEPENDENT_CONFORMANCE:pass(input.D5_DEPENDENT_CONFORMANCE,"D5_PASS_REQUIRED"),
    PILOTE_RUNTIME_HANDOFF_DIGEST:"PINNED_MATCH",
    PILOTE_RUNTIME_SOURCE_MUTATION_COUNT:Number.isSafeInteger(input.runtimeSourceMutationCount)?input.runtimeSourceMutationCount:-1,
    PILOTE_PROVIDER_SPECIFIC_LOGIC:Number.isSafeInteger(input.providerSpecificLogicCount)?input.providerSpecificLogicCount:-1,
    CREDENTIAL_BOUND_LIVE_ACCEPTANCE_REQUIRED_FOR_SEAL:false,
    PILOTE_DEVELOPMENT_SEAL:"PASS"
  };
  if(body.PILOTE_RUNTIME_SOURCE_MUTATION_COUNT!==0)throw new Error("PILOTE_RUNTIME_SOURCE_MUTATION_COUNT_MUST_BE_ZERO");
  if(body.PILOTE_PROVIDER_SPECIFIC_LOGIC!==0)throw new Error("PILOTE_PROVIDER_SPECIFIC_LOGIC_MUST_BE_ZERO");
  return Object.freeze({...body,PILOTE_DEVELOPMENT_SEAL_SHA256:hash(body)});
}

export function compilePiloteDependentHandoffBundleV1(input={}){
  const seal=input.piloteDevelopmentSeal;
  if(!seal||seal.SCHEMA_ID!=="PILOTE_REV52_DEVELOPMENT_SEAL_V1"||seal.PILOTE_DEVELOPMENT_SEAL!=="PASS")throw new Error("PILOTE_DEVELOPMENT_SEAL_REQUIRED");
  const body={
    SCHEMA_ID:"PILOTE_REV52_DEPENDENT_HANDOFF_BUNDLE_V1",
    SCHEMA_VERSION:"1",
    piloteVersion:"5.2",
    piloteSourceIdentity:{head:seal.piloteSourceHead,tree:seal.piloteSourceTree},
    runtimeDependencyLockSha256:seal.runtimeDependencyLockSha256,
    runtimeHandoffDigest:seal.runtimeHandoffDigest,
    runtimeInterfaceDigest:seal.runtimeInterfaceDigest,
    contracts:["RuntimeDependencyLock","AuthoritativePlanCompiler","MasterPlanDependencyGraph","ProjectRunGrant","PhaseExecutionGrant","SourceProgressPolicy","AuthAuthorityPolicy","ContinuationPolicy","PiloteResponseGate","ProviderNeutralJobIntent","ProviderEvidenceAcceptance","AcceptanceDependencyGraph","DependentConformance"],
    acceptanceEvidenceRefs:[...(input.acceptanceEvidenceRefs??[])],
    piloteDevelopmentSealSha256:seal.PILOTE_DEVELOPMENT_SEAL_SHA256,
    PILOTE_DEPENDENT_HANDOFF_BUNDLE:"SEALED",
    PILOTE_TRACK_ENDS_AT_HANDOFF:true,
    AUTO_ADVANCE_PILOTE_TO_CROSS_STACK:false,
    CROSS_STACK_START_REQUIRES_RUNTIME_AND_PILOTE_SEALED:true
  };
  return Object.freeze({...body,handoffDigest:hash(body)});
}

export function validatePiloteDependentHandoffBundleV1(bundle){
  if(!bundle||bundle.SCHEMA_ID!=="PILOTE_REV52_DEPENDENT_HANDOFF_BUNDLE_V1")return Object.freeze({ok:false,errors:["PILOTE_DEPENDENT_HANDOFF_REQUIRED"]});
  const errors=[];
  const {handoffDigest,...body}=bundle;
  if(!SHA256_RE.test(handoffDigest??"")||hash(body)!==handoffDigest)errors.push("PILOTE_DEPENDENT_HANDOFF_DIGEST_MISMATCH");
  if(bundle.PILOTE_DEPENDENT_HANDOFF_BUNDLE!=="SEALED")errors.push("PILOTE_DEPENDENT_HANDOFF_NOT_SEALED");
  if(bundle.PILOTE_TRACK_ENDS_AT_HANDOFF!==true||bundle.AUTO_ADVANCE_PILOTE_TO_CROSS_STACK!==false)errors.push("PILOTE_TRACK_TERMINAL_INVARIANT_FAILED");
  if(bundle.CROSS_STACK_START_REQUIRES_RUNTIME_AND_PILOTE_SEALED!==true)errors.push("CROSS_STACK_SEAL_PREREQUISITE_MISSING");
  return Object.freeze({ok:errors.length===0,errors});
}
