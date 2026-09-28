import { createHash } from "node:crypto";

function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("REFERENCE_ADAPTER_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("REFERENCE_ADAPTER_UNSUPPORTED_CANONICAL_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function clone(v){return JSON.parse(JSON.stringify(v))}

export function createProviderNeutralReferenceAdapterV1({providerId="reference",initialState={},schemaVersion="1"}={}){
  let state=clone(initialState),mutationCount=0,lastOperationId=null;
  return Object.freeze({
    adapterId:`reference:${providerId}`,
    providerId,
    executionClass:"BUILTIN_PROVIDER_API_ADAPTER",
    official:false,
    available:true,
    capabilities:["DISCOVER","READ","MUTATE","READBACK","CLEANUP","RESIDUE_SCAN"],
    discover(){return Object.freeze({providerId,schemaVersion,capabilities:this.capabilities,SCHEMA_SHA256:hash({providerId,schemaVersion,capabilities:this.capabilities})})},
    readCurrent(){return Object.freeze({state:clone(state),STATE_SHA256:hash(state)})},
    diffDesired(desiredState){const currentDigest=hash(state),desiredDigest=hash(desiredState);return Object.freeze({equal:currentDigest===desiredDigest,currentDigest,desiredDigest})},
    mutateMinimalDelta({operationId,desiredState}={}){if(typeof operationId!=="string"||!operationId)throw new Error("OPERATION_ID_REQUIRED");if(lastOperationId===operationId){return Object.freeze({status:"REPLAY",mutationCount,state:clone(state),STATE_SHA256:hash(state)})}if(hash(state)===hash(desiredState)){lastOperationId=operationId;return Object.freeze({status:"SUCCESS_NOOP",mutationCount,state:clone(state),STATE_SHA256:hash(state)})}state=clone(desiredState);mutationCount+=1;lastOperationId=operationId;return Object.freeze({status:"SUCCESS_CHANGED",mutationCount,state:clone(state),STATE_SHA256:hash(state)})},
    authoritativeReadback(){return Object.freeze({state:clone(state),STATE_SHA256:hash(state),mutationCount})},
    cleanup(){return Object.freeze({status:"SUCCESS_NOOP",createdBillableResource:false,ephemeralCredentialCreated:false})},
    residueScan(){return Object.freeze({activePaidCompute:0,orphanedBillableResource:0,billableResidue:0,status:"PASS"})}
  });
}

export function compileRepositoryCiSourceIdentityFixtureV1(input={}){if(typeof input.repository!=="string"||!input.repository)throw new Error("REPOSITORY_REQUIRED");if(!/^[0-9a-f]{40}$/.test(input.head??""))throw new Error("HEAD_SHA_REQUIRED");if(!/^[0-9a-f]{40}$/.test(input.tree??""))throw new Error("TREE_SHA_REQUIRED");const body={SCHEMA_ID:"REPOSITORY_CI_SOURCE_IDENTITY_FIXTURE_V1",SCHEMA_VERSION:"1",repository:input.repository,ref:input.ref??null,head:input.head,tree:input.tree,workflowTriggerRegistered:input.workflowTriggerRegistered===true,workflowDispatchable:input.workflowDispatchable===true,runCreationObserved:input.runCreationObserved===true};return Object.freeze({...body,FIXTURE_SHA256:hash(body)})}
