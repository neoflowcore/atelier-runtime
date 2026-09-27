import { createHash } from "node:crypto";

export const P30_GITHUB_LIVE_TRIGGER_SCHEMA_ID="R51_P30_GITHUB_LIVE_TRIGGER_V1";
const SHA=/^[0-9a-f]{40}$/;const SHA256=/^[0-9a-f]{64}$/;
const obj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("P30_GITHUB_LIVE_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("P30_GITHUB_LIVE_UNSUPPORTED_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");

export function validateP30GitHubLiveTriggerV1(input,{currentParentHead,currentBranch}={}){
  if(!obj(input)||input.SCHEMA_ID!==P30_GITHUB_LIVE_TRIGGER_SCHEMA_ID||input.SCHEMA_VERSION!=="1")throw new Error("P30_GITHUB_LIVE_TRIGGER_SCHEMA_MISMATCH");
  if(!SHA.test(input.APPROVED_SOURCE_PARENT_HEAD??""))throw new Error("P30_GITHUB_LIVE_PARENT_HEAD_INVALID");
  if(currentParentHead&&input.APPROVED_SOURCE_PARENT_HEAD!==currentParentHead)throw new Error("P30_GITHUB_LIVE_PARENT_HEAD_MISMATCH");
  if(currentBranch&&input.TARGET_BRANCH!==currentBranch)throw new Error("P30_GITHUB_LIVE_BRANCH_MISMATCH");
  if(input.PROJECT_IDENTITY_DIGEST!=="9f84671bf806417c39e804e8cc2a91940b13289767e8cfd15830ab064a159e56")throw new Error("P30_GITHUB_LIVE_PROJECT_IDENTITY_MISMATCH");
  if(input.PROJECT_SOURCE_MANIFEST_SHA256!=="a2d8a0224cfdfb773b2f57a14e189fea79d7a0b0e447d74ac26ac70c45329697")throw new Error("P30_GITHUB_LIVE_SOURCE_MANIFEST_MISMATCH");
  if(input.AUTHORITATIVE_MASTER_PLAN_ID!=="runtime-v016"||input.AUTHORITATIVE_MASTER_PLAN_SHA256!=="db21c3488bc6032ec96c9c8c40f82d56ed5808f25325f59c1c0cd33682d3bce2")throw new Error("P30_GITHUB_LIVE_MASTER_PLAN_MISMATCH");
  if(input.EXECUTION_PROVIDER!=="github-actions"||input.EXECUTOR_CLASS!=="repository-hosted-ci-executor")throw new Error("P30_GITHUB_LIVE_EXECUTOR_MISMATCH");
  if(input.NO_NEW_PAID_RESOURCE!==true||input.EXISTING_CI_ENVELOPE!==true)throw new Error("P30_GITHUB_LIVE_RESOURCE_ENVELOPE_MISMATCH");
  const cost=input.CI_COST_ENVELOPE;if(!obj(cost)||cost.RUNNER_LABEL!=="ubuntu-24.04"||cost.LIST_RATE_MICROUSD_PER_MINUTE!==6000||cost.TIMEOUT_MINUTES!==5||cost.MAX_LIST_PRICE_MILLI_USD!==30||cost.BILLING_ROUNDING!=="CEIL_MINUTE")throw new Error("P30_GITHUB_LIVE_COST_ENVELOPE_MISMATCH");
  if(input.ACTION_ECONOMY_FINAL_INTEGRATION_RUN!==true)throw new Error("P30_GITHUB_LIVE_ACTION_ECONOMY_MARKER_REQUIRED");
  if(input.RELEASE_ACCEPTANCE_GRANTED!==false)throw new Error("P30_GITHUB_LIVE_RELEASE_AUTHORITY_MUST_REMAIN_SEPARATE");
  const body={...input};delete body.TRIGGER_SHA256;
  return Object.freeze({...body,TRIGGER_SHA256:hash(body)});
}

export function compileP30GitHubLiveObservationV1(input={}){
  const required=["SOURCE_PROVENANCE","BINDING_IDENTITY","PRODUCTION_ATTESTATION","PROVIDER_QUALIFICATION","CREDENTIAL_LIVE_BINDING","FAILURE_QUALIFICATION_REUSED","NO_NEW_PAID_RESOURCE","CLEANUP_SUCCESS_NOOP"];
  const checks=Object.fromEntries(required.map(k=>[k,input[k]===true]));
  const missing=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k).sort();
  if(!SHA.test(input.EXECUTION_HEAD??""))throw new Error("P30_GITHUB_LIVE_EXECUTION_HEAD_INVALID");
  if(!SHA256.test(input.PRODUCTION_ATTESTATION_RECEIPT_SHA256??""))throw new Error("P30_GITHUB_LIVE_ATTESTATION_SHA_REQUIRED");
  if(!SHA256.test(input.PROVIDER_OBSERVATION_SHA256??""))throw new Error("P30_GITHUB_LIVE_PROVIDER_SHA_REQUIRED");
  const body={SCHEMA_ID:"R51_P30_GITHUB_LIVE_OBSERVATION_V1",SCHEMA_VERSION:"1",EXECUTION_HEAD:input.EXECUTION_HEAD,RUN_ID:input.RUN_ID,JOB_ID:input.JOB_ID,CHECKS:checks,MISSING:missing,COST_BASIS:input.COST_BASIS,PRODUCTION_ATTESTATION_RECEIPT_SHA256:input.PRODUCTION_ATTESTATION_RECEIPT_SHA256,PROVIDER_OBSERVATION_SHA256:input.PROVIDER_OBSERVATION_SHA256,UNEXPECTED_BILLABLE_RESIDUE:input.UNEXPECTED_BILLABLE_RESIDUE??0,EXPECTED_ARTIFACT_RETENTION_CLASS:"ARTIFACT_RETENTION",PASS:missing.length===0};
  return Object.freeze({...body,OBSERVATION_SHA256:hash(body)});
}
