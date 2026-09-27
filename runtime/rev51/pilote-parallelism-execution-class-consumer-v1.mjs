import { createHash } from "node:crypto";
import { deriveAdmissionBudgetProjectionV1, validateDurableAdmissionBudgetV1 } from "./durable-admission-budget-cancellation-v1.mjs";

export const A6_AUTHORITATIVE_BINDING = Object.freeze({
  REPOSITORY:"neoflowcore/atelier-runtime",
  BRANCH:"pilote-r51-a6-parallelism-execution-class-intent",
  HEAD:"878e5966f6a4c3fc45f76659f83d107f17ce9f6d",
  TREE:"e4eb4a8a1887fb859f0504431584f5f66869ce3b",
  MODULE_SHA256:"149668f616aee87a08e986c6c12e971893ddca51a6ccf1b7d555d7f669c24c15",
  SCHEMA_SHA256:"f15d74050a35c56eb036deccd67f670953d2719082de2505f2881596e3bd2704",
  CANONICALIZATION_ID:"ATELIER_EXECUTION_CANONICAL_JSON_V1",
  TEST_VECTOR_SET_SHA256:"3f768f91f135e43e4e041d1bc642174dcacc2554f9c4054a82a3302d13add0ca",
  EXPECTED_RESULT_SET_SHA256:"3a612965e62cc0cc2d497955538755772f9b7d237e63678f97c62d6e48ef13af",
  AUTHORITATIVE_MANIFEST_SHA256:"29f7e31bafb295f3e6291ef30717dba080bb8a095cb4870c2ace9220ec94526a",
  CONTRACT_SET_SHA256:"a8b220c92a47306061e9aca1c65077d357b00bda12e9daad4f37215256083f4a"
});
export const A6_PARALLELISM_INTENTS=Object.freeze(["INHERIT_DAG","PARALLEL_ALLOWED","SERIAL_REQUIRED"]);
export const A6_EXECUTION_CLASSES=Object.freeze(["RUNTIME_DEFAULT","HOSTED_ELIGIBLE","SELF_HOSTED_REQUIRED","HOST_LOCAL_REQUIRED"]);

const SHA=/^[0-9a-f]{64}$/;
const KEYS=["A6_INTENT_SHA256","ADMISSION_INTERSECTION_POLICY","CANONICALIZATION_ID","CONTRACT_SET_REF","EFFECTIVE_PARALLELISM_CAP","EXECUTION_CLASS","EXECUTION_CLASS_PROVIDER_SELECTION","EXECUTION_CLASS_SOURCE_REF","EXECUTION_INTENT_SHA256","HARD_EXECUTION_CLASS_DOWNGRADE","INHERIT_DAG_POLICY","INTENT_TYPE","INTENT_VERSION","MAX_PARALLELISM","MAX_PARALLELISM_SOURCE_REF","PARALLELISM_INTENT","PARALLELISM_INTENT_SOURCE_REF","PARALLEL_ALLOWED_POLICY","PHASE_ID","PROJECT_ID","PROVIDER_TRANSPORT_INDEPENDENCE","RUNTIME_EXECUTION_ONLY_EDGE_ADD","RUNTIME_SEMANTIC_EDGE_ADD","RUNTIME_SEMANTIC_EDGE_REMOVE","RUNTIME_STRICTER_LIMIT","SEMANTIC_DEPENDENCY_REFS","SEMANTIC_DEPENDENCY_REFS_SOURCE_REF","SERIAL_REQUIRED_POLICY","TASK_CONTRACT_SHA256","TASK_ID"];
const FORBIDDEN=new Set(["PROVIDER_ID","PROVIDER_RESOURCE_ID","WORKER_ID","RUNNER_ID","VM_ID","RESERVATION_ID","SCHEDULER_ID","QUEUE_ID","ATTEMPT_ID","LEASE_ID","FENCE_TOKEN","OPERATION_ID","IDEMPOTENCY_KEY","SECRET_VALUE"]);
function object(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function exact(v,keys){if(!object(v))return false;const a=Object.keys(v).sort(),b=[...keys].sort();return a.length===b.length&&a.every((x,i)=>x===b[i])}
function sameArray(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i])}
function canonical(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("A6_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return"["+v.map(canonical).join(",")+"]";if(object(v))return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";throw new Error("A6_UNSUPPORTED_CANONICAL_TYPE")}
function hash(v){return createHash("sha256").update(canonical(v),"utf8").digest("hex")}
function scan(v,path="$"){const errors=[];if(Array.isArray(v))v.forEach((x,i)=>errors.push(...scan(x,path+"["+i+"]")));else if(object(v))for(const [k,x] of Object.entries(v)){if(FORBIDDEN.has(k))errors.push("FORBIDDEN_RUNTIME_OWNED_KEY:"+path+"."+k);errors.push(...scan(x,path+"."+k))}return errors}
function positive(v,code){if(!Number.isSafeInteger(v)||v<1)throw new Error(code);return v}

export function deriveA6ParallelismProjectionV1(intent,max){
  if(!A6_PARALLELISM_INTENTS.includes(intent))throw new Error("PARALLELISM_INTENT_UNSUPPORTED");
  positive(max,"MAX_PARALLELISM_INVALID");
  if(intent==="SERIAL_REQUIRED")return Object.freeze({SCHEDULING_MODE:"SERIAL_ONLY",EFFECTIVE_PARALLELISM_CAP:1,PARALLELISM_IS_PERMISSION_ONLY:false,SEMANTIC_DAG_MUST_BE_PRESERVED:true});
  return Object.freeze({SCHEDULING_MODE:intent==="PARALLEL_ALLOWED"?"PARALLEL_PERMITTED":"DAG_CONSTRAINED",EFFECTIVE_PARALLELISM_CAP:max,PARALLELISM_IS_PERMISSION_ONLY:true,SEMANTIC_DAG_MUST_BE_PRESERVED:true});
}
export function deriveA6ExecutionClassProjectionV1(value){
  if(!A6_EXECUTION_CLASSES.includes(value))throw new Error("EXECUTION_CLASS_UNSUPPORTED");
  if(value==="SELF_HOSTED_REQUIRED")return Object.freeze({CONSTRAINT_KIND:"HARD_REQUIREMENT",REQUIRED_CLASS:"SELF_HOSTED",HOSTED_ELIGIBLE:false,CONCRETE_PROVIDER_SELECTION:"RUNTIME_OWNED",SILENT_DOWNGRADE_ALLOWED:false});
  if(value==="HOST_LOCAL_REQUIRED")return Object.freeze({CONSTRAINT_KIND:"HARD_REQUIREMENT",REQUIRED_CLASS:"HOST_LOCAL",HOSTED_ELIGIBLE:false,CONCRETE_PROVIDER_SELECTION:"RUNTIME_OWNED",SILENT_DOWNGRADE_ALLOWED:false});
  if(value==="HOSTED_ELIGIBLE")return Object.freeze({CONSTRAINT_KIND:"ELIGIBILITY",REQUIRED_CLASS:null,HOSTED_ELIGIBLE:true,CONCRETE_PROVIDER_SELECTION:"RUNTIME_OWNED",SILENT_DOWNGRADE_ALLOWED:false});
  return Object.freeze({CONSTRAINT_KIND:"RUNTIME_DEFAULT",REQUIRED_CLASS:null,HOSTED_ELIGIBLE:null,CONCRETE_PROVIDER_SELECTION:"RUNTIME_OWNED",SILENT_DOWNGRADE_ALLOWED:false});
}
export function computeA6IntentSha256V1(intent){const copy=structuredClone(intent);delete copy.A6_INTENT_SHA256;return hash(copy)}

export function validateA6IntentV1(intent){
  const errors=[];
  if(!exact(intent,KEYS))errors.push("A6_TOP_LEVEL_FIELDS_MISMATCH");
  errors.push(...scan(intent));
  if(intent?.INTENT_TYPE!=="PILOTE_PARALLELISM_EXECUTION_CLASS_INTENT_V1")errors.push("A6_INTENT_TYPE_MISMATCH");
  if(intent?.INTENT_VERSION!=="1.0.0")errors.push("A6_INTENT_VERSION_MISMATCH");
  if(intent?.CANONICALIZATION_ID!==A6_AUTHORITATIVE_BINDING.CANONICALIZATION_ID)errors.push("A6_CANONICALIZATION_ID_MISMATCH");
  for(const k of ["PROJECT_ID","PHASE_ID","TASK_ID"])if(typeof intent?.[k]!=="string"||!intent[k])errors.push(k+"_INVALID");
  if(!A6_EXECUTION_CLASSES.includes(intent?.EXECUTION_CLASS))errors.push("EXECUTION_CLASS_INVALID");
  if(!A6_PARALLELISM_INTENTS.includes(intent?.PARALLELISM_INTENT))errors.push("PARALLELISM_INTENT_INVALID");
  if(intent?.EXECUTION_CLASS_SOURCE_REF!=="task-contract:RESOURCE_REQUIREMENTS.EXECUTION_CLASS")errors.push("EXECUTION_CLASS_SOURCE_REF_MISMATCH");
  if(intent?.PARALLELISM_INTENT_SOURCE_REF!=="execution-intent:PARALLELISM_INTENT")errors.push("PARALLELISM_INTENT_SOURCE_REF_MISMATCH");
  if(intent?.SEMANTIC_DEPENDENCY_REFS_SOURCE_REF!=="execution-intent:SEMANTIC_DEPENDENCY_REFS")errors.push("SEMANTIC_DEPENDENCY_REFS_SOURCE_REF_MISMATCH");
  if(intent?.MAX_PARALLELISM_SOURCE_REF!=="task-contract:ECONOMY_BUDGET.MAX_PARALLELISM")errors.push("MAX_PARALLELISM_SOURCE_REF_MISMATCH");
  if(!Number.isSafeInteger(intent?.MAX_PARALLELISM)||intent.MAX_PARALLELISM<1||intent.MAX_PARALLELISM>1024)errors.push("MAX_PARALLELISM_INVALID");
  if(!Array.isArray(intent?.SEMANTIC_DEPENDENCY_REFS)||intent.SEMANTIC_DEPENDENCY_REFS.some(x=>typeof x!=="string"||!x))errors.push("SEMANTIC_DEPENDENCY_REFS_INVALID");
  for(const k of ["TASK_CONTRACT_SHA256","EXECUTION_INTENT_SHA256","A6_INTENT_SHA256"])if(!SHA.test(intent?.[k]??""))errors.push(k+"_INVALID");
  let p=null;try{p=deriveA6ParallelismProjectionV1(intent?.PARALLELISM_INTENT,intent?.MAX_PARALLELISM)}catch{}
  if(p&&intent.EFFECTIVE_PARALLELISM_CAP!==p.EFFECTIVE_PARALLELISM_CAP)errors.push("EFFECTIVE_PARALLELISM_CAP_MISMATCH");
  const policies={PARALLEL_ALLOWED_POLICY:"PERMISSION_NOT_OBLIGATION",INHERIT_DAG_POLICY:"FOLLOW_SEMANTIC_DAG",SERIAL_REQUIRED_POLICY:"EFFECTIVE_CAP_ONE",RUNTIME_STRICTER_LIMIT:"ALLOW",RUNTIME_SEMANTIC_EDGE_ADD:"DENY",RUNTIME_SEMANTIC_EDGE_REMOVE:"DENY",RUNTIME_EXECUTION_ONLY_EDGE_ADD:"ALLOW",HARD_EXECUTION_CLASS_DOWNGRADE:"DENY",EXECUTION_CLASS_PROVIDER_SELECTION:"RUNTIME_OWNED",PROVIDER_TRANSPORT_INDEPENDENCE:"REQUIRED",ADMISSION_INTERSECTION_POLICY:"ALL_APPLICABLE_LIMITS_MUST_PASS"};
  for(const [k,v] of Object.entries(policies))if(intent?.[k]!==v)errors.push(k+"_MISMATCH");
  if(!object(intent?.CONTRACT_SET_REF)||intent.CONTRACT_SET_REF.ID!=="ATELIER_REV51_CONTRACT_SET_V1"||intent.CONTRACT_SET_REF.VERSION!=="1.0.0"||intent.CONTRACT_SET_REF.SHA256!==A6_AUTHORITATIVE_BINDING.CONTRACT_SET_SHA256)errors.push("CONTRACT_SET_REF_MISMATCH");
  if(SHA.test(intent?.A6_INTENT_SHA256??""))try{if(computeA6IntentSha256V1(intent)!==intent.A6_INTENT_SHA256)errors.push("A6_INTENT_SHA256_MISMATCH")}catch(e){errors.push("A6_CANONICALIZATION_REJECTED:"+e.message)}
  return {ok:errors.length===0,errors};
}

export function validateA6RuntimeBindingV1(input){
  const {a6Intent,runtimePlan,admissionStore,runtimeLimits,selection,semanticDependencyRefs,executionOnlyEdges=[]}=input??{};
  const errors=[];
  const a6=validateA6IntentV1(a6Intent); if(!a6.ok)errors.push(...a6.errors.map(x=>"A6:"+x));
  if(!object(runtimePlan))errors.push("RUNTIME_PLAN_REQUIRED"); else {
    if(runtimePlan.TASK_CONTRACT_SHA256!==a6Intent?.TASK_CONTRACT_SHA256)errors.push("TASK_CONTRACT_SHA256_BINDING_MISMATCH");
    if(runtimePlan.EXECUTION_INTENT_SHA256!==a6Intent?.EXECUTION_INTENT_SHA256)errors.push("EXECUTION_INTENT_SHA256_BINDING_MISMATCH");
    if(runtimePlan.PARALLELISM_INTENT!==a6Intent?.PARALLELISM_INTENT)errors.push("PARALLELISM_INTENT_BINDING_MISMATCH");
    if(!sameArray(runtimePlan.SEMANTIC_DEPENDENCY_REFS,a6Intent?.SEMANTIC_DEPENDENCY_REFS))errors.push("SEMANTIC_DAG_RUNTIME_PLAN_MISMATCH");
  }
  const p2g=validateDurableAdmissionBudgetV1(admissionStore);
  if(!p2g.ok)errors.push(...p2g.errors.map(x=>"P2G:"+x)); else {
    if(admissionStore.TASK_CONTRACT_SHA256!==a6Intent?.TASK_CONTRACT_SHA256)errors.push("P2G_TASK_CONTRACT_SHA256_MISMATCH");
    if(admissionStore.EXECUTION_INTENT_SHA256!==a6Intent?.EXECUTION_INTENT_SHA256)errors.push("P2G_EXECUTION_INTENT_SHA256_MISMATCH");
    if(admissionStore.ECONOMY_BUDGET.MAX_PARALLELISM!==a6Intent?.MAX_PARALLELISM)errors.push("P2G_MAX_PARALLELISM_BINDING_MISMATCH");
  }
  if(!sameArray(semanticDependencyRefs,a6Intent?.SEMANTIC_DEPENDENCY_REFS))errors.push("SEMANTIC_DAG_PRESERVATION_MISMATCH");
  if(!Array.isArray(executionOnlyEdges)||executionOnlyEdges.some(x=>typeof x!=="string"||!x))errors.push("EXECUTION_ONLY_EDGES_INVALID");

  let parallel=null,executionClass=null;
  try{parallel=deriveA6ParallelismProjectionV1(a6Intent?.PARALLELISM_INTENT,a6Intent?.MAX_PARALLELISM)}catch{}
  try{executionClass=deriveA6ExecutionClassProjectionV1(a6Intent?.EXECUTION_CLASS)}catch{}
  if(!object(selection))errors.push("RUNTIME_SELECTION_REQUIRED"); else {
    if(selection.PROVIDER_SELECTION_SOURCE!=="RUNTIME")errors.push("PROVIDER_SELECTION_OWNERSHIP_MISMATCH");
    if(selection.TRANSPORT_SELECTION_SOURCE!=="RUNTIME")errors.push("TRANSPORT_SELECTION_OWNERSHIP_MISMATCH");
    if(typeof selection.COMPUTE_PROVIDER!=="string"||!selection.COMPUTE_PROVIDER)errors.push("COMPUTE_PROVIDER_REQUIRED");
    if(typeof selection.EXECUTION_TRANSPORT!=="string"||!selection.EXECUTION_TRANSPORT)errors.push("EXECUTION_TRANSPORT_REQUIRED");
    if(executionClass?.CONSTRAINT_KIND==="HARD_REQUIREMENT"&&selection.EXECUTION_CLASS_REALIZATION!==executionClass.REQUIRED_CLASS)errors.push("HARD_EXECUTION_CLASS_DOWNGRADE_DENIED");
    if(executionClass?.CONSTRAINT_KIND!=="HARD_REQUIREMENT"&&!["HOSTED","SELF_HOSTED","HOST_LOCAL"].includes(selection.EXECUTION_CLASS_REALIZATION))errors.push("EXECUTION_CLASS_REALIZATION_INVALID");
  }

  let effective=null;
  if(!object(runtimeLimits))errors.push("RUNTIME_LIMITS_REQUIRED"); else if(parallel){
    const caps=[parallel.EFFECTIVE_PARALLELISM_CAP];
    for(const k of ["PROJECT_CONCURRENCY_LIMIT","PROVIDER_CONCURRENCY_LIMIT","EXECUTION_CLASS_LIMIT"]){
      const v=runtimeLimits[k]; if(v!==null&&v!==undefined){if(!Number.isSafeInteger(v)||v<1)errors.push(k+"_INVALID");else caps.push(v)}
    }
    effective=Math.min(...caps);
    if(!Number.isSafeInteger(runtimeLimits.REQUESTED_PARALLELISM)||runtimeLimits.REQUESTED_PARALLELISM<1)errors.push("REQUESTED_PARALLELISM_INVALID");
    else if(runtimeLimits.REQUESTED_PARALLELISM>effective)errors.push("ADMISSION_PARALLELISM_INTERSECTION_DENIED");
    if(runtimeLimits.ACTIVE_COST_RESERVATION_REQUIRED===true&&runtimeLimits.ACTIVE_COST_RESERVATION_AVAILABLE!==true)errors.push("ACTIVE_COST_RESERVATION_REQUIRED");
    if(p2g.ok){
      const projection=deriveAdmissionBudgetProjectionV1(admissionStore);
      if(projection.ACTIVE_RESERVATION_COUNT+Math.max(runtimeLimits.REQUESTED_PARALLELISM??0,0)>effective)errors.push("P2G_ACTIVE_RESERVATION_INTERSECTION_DENIED");
    }
  }
  return {ok:errors.length===0,errors,projection:errors.length?null:Object.freeze({
    A6_EFFECTIVE_PARALLELISM_CAP:parallel.EFFECTIVE_PARALLELISM_CAP,
    EFFECTIVE_PARALLELISM_CAP:effective,
    SCHEDULING_MODE:parallel.SCHEDULING_MODE,
    PARALLELISM_IS_PERMISSION_ONLY:parallel.PARALLELISM_IS_PERMISSION_ONLY,
    SEMANTIC_DAG_MUST_BE_PRESERVED:true,
    EXECUTION_ONLY_EDGE_COUNT:executionOnlyEdges.length,
    EXECUTION_CLASS:a6Intent.EXECUTION_CLASS,
    EXECUTION_CLASS_CONSTRAINT:executionClass,
    PROVIDER_SELECTION_OWNERSHIP:"RUNTIME",
    PROVIDER_TRANSPORT_INDEPENDENCE:"REQUIRED",
    ADMISSION_INTERSECTION_POLICY:"ALL_APPLICABLE_LIMITS_MUST_PASS"
  })};
}
