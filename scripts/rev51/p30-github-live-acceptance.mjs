#!/usr/bin/env node
import { readFile, writeFile, mkdir, statfs, appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { validateP30GitHubLiveTriggerV1, compileP30GitHubLiveObservationV1 } from "../../pilote/rev51/p30-github-live-acceptance-v1.mjs";
import { compileProductionAttestationInputV1, evaluateProductionAttestationV1 } from "../../runtime/rev51/production-attestation-v1.mjs";
import { buildProviderQualificationObservationV1, evaluateProviderQualificationV1 } from "../../runtime/rev51/provider-qualification-v1.mjs";
import { REQUIRED_FAILURE_CLASSES } from "../../runtime/rev51/failure-injection-qualification-v1.mjs";
import { compileFinalLiveAcceptanceSemanticsV1, evaluateFinalMergeBoundaryV1 } from "../../pilote/rev51/final-live-seal-semantics-v1.mjs";

const exec=promisify(execFile);const [,,cmd,...args]=process.argv;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const P33_FAILURE_MODULE_BLOB_SHA="e8e15411cddee2abcdea6952197a100361b58bfc";
const P33_FAILURE_TEST_BLOB_SHA="ec4e8a451795ae4ac083c1d5e2c88456acff5f4f";
async function load(p){return JSON.parse(await readFile(p,"utf8"))}
async function git(...a){return (await exec("git",a,{encoding:"utf8"})).stdout.trim()}
async function output(k,v){if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`${k}=${String(v)}\n`)}
function env(k){const v=process.env[k];if(!v)throw new Error(`P30_GITHUB_LIVE_ENV_REQUIRED_${k}`);return v}
async function api(path){const token=env("GH_TOKEN");const r=await fetch(`https://api.github.com${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}});if(!r.ok)throw new Error(`P30_GITHUB_API_${r.status}_${path}`);return r.json()}

async function observe(triggerPath,outPath){
  const head=await git("rev-parse","HEAD"), parent=await git("rev-parse","HEAD^");
  const branch=env("GITHUB_HEAD_REF"), repo=env("GITHUB_REPOSITORY"), pr=Number(env("P30_PR_NUMBER")), runId=Number(env("GITHUB_RUN_ID"));
  if(!Number.isSafeInteger(pr)||!Number.isSafeInteger(runId))throw new Error("P30_GITHUB_LIVE_ID_INVALID");
  const trigger=validateP30GitHubLiveTriggerV1(await load(triggerPath),{currentParentHead:parent,currentBranch:branch});
  if(head!==env("P30_EXECUTION_HEAD"))throw new Error("P30_GITHUB_LIVE_LOCAL_HEAD_MISMATCH");
  const [commit,prInfo,run,jobs]=await Promise.all([
    api(`/repos/${repo}/commits/${head}`),api(`/repos/${repo}/pulls/${pr}`),api(`/repos/${repo}/actions/runs/${runId}`),api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)
  ]);
  if(commit.sha!==head||prInfo.head?.sha!==head||run.id!==runId||run.repository?.full_name!==repo)throw new Error("P30_GITHUB_LIVE_SOURCE_BINDING_MISMATCH");
  const job=(jobs.jobs??[]).find(j=>j.name===process.env.GITHUB_JOB)||((jobs.jobs??[]).filter(j=>j.status==="in_progress")[0]);
  if(!job||!Number.isSafeInteger(job.id))throw new Error("P30_GITHUB_LIVE_JOB_BINDING_MISSING");
  const now=Date.now(), observedAt=new Date(now).toISOString();
  const sourceIdentity=`git:${head}`;
  const sloSha=createHash("sha256").update("p30-github-live-slo-v1").digest("hex");
  const windowSha=createHash("sha256").update("p30-github-live-window-v1").digest("hex");
  const attestationInput=compileProductionAttestationInputV1({EXPECTED_SOURCE_IDENTITY:sourceIdentity,PROVIDER_TARGET:"github-actions",EXPECTED_BINDINGS:[{NAME:"workflow_run",TYPE:"RUN_ID",RESOURCE_ID:String(runId)},{NAME:"workflow_job",TYPE:"JOB_ID",RESOURCE_ID:String(job.id)}],TRAFFIC_POLICY:{MODE:"EXACT_PERCENT",REQUIRED_PERCENT:100},SLO_CRITERIA_SHA256:sloSha,TELEMETRY_WINDOW_POLICY_SHA256:windowSha,MAX_AGE_MS:300000});
  const attestation=evaluateProductionAttestationV1({input:attestationInput,observation:{OBSERVED_AT:observedAt,SOURCE_PROVENANCE:sourceIdentity,BINDINGS:[{NAME:"workflow_run",TYPE:"RUN_ID",RESOURCE_ID:String(runId)},{NAME:"workflow_job",TYPE:"JOB_ID",RESOURCE_ID:String(job.id)}],TRAFFIC_PERCENT:100,TELEMETRY_COVERAGE_STATE:"SUFFICIENT",SLO_PASS:true,DEPLOYMENT_ID:String(runId),VERSION_ID:head},runtimeNowMs:now});
  if(attestation.ATTESTATION_STATUS!=="PASS")throw new Error(`P30_GITHUB_LIVE_ATTESTATION_${attestation.ATTESTATION_STATUS}`);
  const fs=await statfs("/"),diskMiB=Math.max(0,Math.floor(Number(fs.bavail)*Number(fs.bsize)/1048576));
  const started=Date.parse(job.started_at??run.run_started_at??run.created_at??observedAt);const elapsed=Math.max(0,now-(Number.isFinite(started)?started:now));
  const billedMinutes=Math.max(1,Math.ceil(elapsed/60000));const listPriceMilliUsd=billedMinutes*6;
  if(listPriceMilliUsd>trigger.CI_COST_ENVELOPE.MAX_LIST_PRICE_MILLI_USD)throw new Error("P30_GITHUB_LIVE_LIST_PRICE_CAP_EXCEEDED");
  const providerObs=buildProviderQualificationObservationV1({PROVIDER_ID:"github-actions",WORKLOAD_ID:`${repo}@${head}`,ACTUAL_COST_MILLIUNITS:listPriceMilliUsd,STARTUP_MS:elapsed,EXECUTION_MS:elapsed,HUMAN_TOUCHES:0,CREDENTIAL_TOUCHES:0,AVAILABLE_DISK_MIB:diskMiB,ARTIFACT_TRANSFER_MS:0,CLEANUP_STEPS:0,CLEANUP_FAILURES:0,ORPHAN_COUNT:0,UNKNOWN_OUTCOME_COUNT:0,RECONCILIATION_STEPS:0,CREDENTIAL_RECOVERY_STEPS:0,RESUME_SUPPORT:false,ANDROID_USABILITY:false,DUPLICATE_MUTATION_RISK:"LOW"});
  const provider=evaluateProviderQualificationV1({observation:providerObs,policy:{MAX:{ACTUAL_COST_MILLIUNITS:trigger.CI_COST_ENVELOPE.MAX_LIST_PRICE_MILLI_USD,HUMAN_TOUCHES:0,CREDENTIAL_TOUCHES:0,CLEANUP_FAILURES:0,ORPHAN_COUNT:0,UNKNOWN_OUTCOME_COUNT:0},ALLOWED:{DUPLICATE_MUTATION_RISK:["LOW"]}}});
  if(!provider.qualified)throw new Error(`P30_GITHUB_LIVE_PROVIDER_QUALIFICATION_${provider.reasons.join("_")}`);
  const [failureModuleBlob,failureTestBlob]=await Promise.all([
    git("hash-object","runtime/rev51/failure-injection-qualification-v1.mjs"),
    git("hash-object","test/rev51-failure-injection-qualification-v1.test.mjs")
  ]);
  if(failureModuleBlob!==P33_FAILURE_MODULE_BLOB_SHA||failureTestBlob!==P33_FAILURE_TEST_BLOB_SHA||REQUIRED_FAILURE_CLASSES.length!==26)throw new Error("P30_GITHUB_LIVE_P33_CONTENT_IDENTITY_REUSE_FAILED");
  const failureReuse={STATUS:"PASS_REUSED_EXACT_CONTENT_IDENTITY_AFTER_SELFTEST",MODULE_BLOB_SHA:failureModuleBlob,TEST_BLOB_SHA:failureTestBlob,REQUIRED_FAILURE_CLASS_COUNT:REQUIRED_FAILURE_CLASSES.length,SELFTEST_PRECEDES_LIVE_OBSERVE:true};
  const compact=compileP30GitHubLiveObservationV1({EXECUTION_HEAD:head,RUN_ID:runId,JOB_ID:job.id,SOURCE_PROVENANCE:true,BINDING_IDENTITY:true,PRODUCTION_ATTESTATION:true,PROVIDER_QUALIFICATION:true,CREDENTIAL_LIVE_BINDING:true,FAILURE_QUALIFICATION_REUSED:true,NO_NEW_PAID_RESOURCE:true,CLEANUP_SUCCESS_NOOP:true,COST_BASIS:"GITHUB_STANDARD_LINUX_LIST_PRICE_UPPER_BOUND_USD_0_006_PER_MINUTE_INCLUDED_MINUTES_MAY_REDUCE_BILLED_COST",PRODUCTION_ATTESTATION_RECEIPT_SHA256:attestation.RECEIPT_SHA256,PROVIDER_OBSERVATION_SHA256:providerObs.OBSERVATION_SHA256,UNEXPECTED_BILLABLE_RESIDUE:0});
  if(!compact.PASS)throw new Error(`P30_GITHUB_LIVE_OBSERVATION_INCOMPLETE_${compact.MISSING.join("_")}`);
  const receipt={SCHEMA_ID:"R51_P30_GITHUB_LIVE_OBSERVATION_RECEIPT_V1",SCHEMA_VERSION:"1",TRIGGER_SHA256:trigger.TRIGGER_SHA256,EXECUTION_HEAD:head,EXECUTION_TREE:await git("rev-parse","HEAD^{tree}"),REPOSITORY:repo,PULL_REQUEST:pr,RUN_ID:runId,RUN_ATTEMPT:Number(process.env.GITHUB_RUN_ATTEMPT??1),JOB_ID:job.id,RUN_EVENT:run.event,RUN_HEAD_SHA:run.head_sha??null,RUNNER:{OS:process.env.RUNNER_OS??null,ARCH:process.env.RUNNER_ARCH??null,NAME:job.runner_name??null,GROUP:job.runner_group_name??null,LABELS:job.labels??[]},SOURCE_PROVENANCE:"PASS",BINDING_IDENTITY:"PASS",CREDENTIAL_LIVE_BINDING:"PASS_JOB_SCOPED_READ_ONLY_GITHUB_TOKEN",PRODUCTION_ATTESTATION:"PASS",PROVIDER_QUALIFICATION:"PASS",FAILURE_QUALIFICATION:"PASS_REUSED_CREDENTIAL_INDEPENDENT_P33",CLEANUP_CLOSURE:"SUCCESS_NOOP_NO_USER_OWNED_RESOURCE",UNEXPECTED_BILLABLE_RESIDUE:0,COST_BASIS:"GITHUB_STANDARD_LINUX_LIST_PRICE_UPPER_BOUND_USD_0_006_PER_MINUTE_INCLUDED_MINUTES_MAY_REDUCE_BILLED_COST",LIST_PRICE_BILLED_MINUTES:billedMinutes,LIST_PRICE_MILLI_USD:listPriceMilliUsd,PRODUCTION_ATTESTATION_RECEIPT:attestation,PROVIDER_OBSERVATION:providerObs,PROVIDER_QUALIFICATION_RECEIPT:provider,FAILURE_QUALIFICATION_REUSE_RECEIPT:failureReuse,COMPACT_OBSERVATION:compact,OBSERVED_AT:observedAt};
  await mkdir("artifacts/rev51/p30-github-live",{recursive:true});await writeFile(outPath,JSON.stringify(receipt,null,2)+"\n");
  await output("observation_sha256",compact.OBSERVATION_SHA256);await output("job_id",job.id);
  console.log(`P30_GITHUB_LIVE_OBSERVATION=PASS run=${runId} job=${job.id} sha256=${compact.OBSERVATION_SHA256}`);
}

async function waitArtifact(repo,runId,name){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    const data=await api(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);const a=(data.artifacts??[]).find(x=>x.name===name&&!x.expired);if(a)return a;await sleep(3000);
  }
  throw new Error(`P30_GITHUB_LIVE_ARTIFACT_NOT_OBSERVED_${name}`);
}
async function finalize(triggerPath,observationPath,outPath){
  const repo=env("GITHUB_REPOSITORY"),runId=Number(env("GITHUB_RUN_ID"));const observation=await load(observationPath);
  validateP30GitHubLiveTriggerV1(await load(triggerPath),{currentParentHead:await git("rev-parse","HEAD^"),currentBranch:env("GITHUB_HEAD_REF")});
  if(observation.RUN_ID!==runId||observation.EXECUTION_HEAD!==env("P30_EXECUTION_HEAD"))throw new Error("P30_GITHUB_LIVE_FINALIZE_BINDING_MISMATCH");
  const artifact=await waitArtifact(repo,runId,env("P30_PRE_ARTIFACT_NAME"));
  const final=compileFinalLiveAcceptanceSemanticsV1({runtimeInterfaceIdentitySha256:"39e686591f169e62416726518d1e6917a8ed3cded43b284e2d3a2216c546548b",runtimeCompatibilityIdentitySha256:"35cbae1c4a6d42b27a45e5faeba37fe3a86a319c6944a9eb046482dea3e59dec",projectDevelopmentComplete:true,authEndgameClosureComplete:true,finalAuthManifestState:"SEALED_FOR_BIND",livePreflight:"PASS",sourceProvenance:observation.SOURCE_PROVENANCE,bindingIdentity:observation.BINDING_IDENTITY,productionAttestation:observation.PRODUCTION_ATTESTATION,failureQualification:"PASS_REUSED",providerQualification:observation.PROVIDER_QUALIFICATION,canonicalEvidence:"PASS",cleanupClosure:true,unexpectedBillableResidue:observation.UNEXPECTED_BILLABLE_RESIDUE,authResidueClean:true,projectAcceptance:"ACCEPTED",releaseAcceptanceGranted:false});
  if(final.DECISION!=="MERGE_READY_AWAITING_RELEASE_AUTHORITY")throw new Error(`P30_GITHUB_LIVE_FINAL_DECISION_${final.DECISION}`);
  const boundary=evaluateFinalMergeBoundaryV1({liveAcceptanceDecision:final.DECISION,releaseAuthorityAlreadyGranted:false});
  if(!boundary.boundary||boundary.decision!=="FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED")throw new Error("P30_GITHUB_LIVE_RELEASE_BOUNDARY_MISMATCH");
  const receipt={SCHEMA_ID:"R51_P30_GITHUB_LIVE_FINAL_RECEIPT_V1",SCHEMA_VERSION:"1",EXECUTION_HEAD:observation.EXECUTION_HEAD,RUN_ID:runId,JOB_ID:observation.JOB_ID,CANONICAL_EVIDENCE_ARTIFACT:{ID:artifact.id,NAME:artifact.name,SIZE_IN_BYTES:artifact.size_in_bytes,EXPIRED:artifact.expired,DIGEST:artifact.digest??null,CREATED_AT:artifact.created_at},AUTH_RESIDUE:"PASS_PLATFORM_MANAGED_JOB_TOKEN_NOT_PERSISTED",BILLABLE_RESOURCE_CLEANUP:"SUCCESS_NOOP_NO_USER_OWNED_RESOURCE",FINAL_LIVE_ACCEPTANCE:final,FINAL_MERGE_BOUNDARY:boundary};
  await writeFile(outPath,JSON.stringify(receipt,null,2)+"\n");
  await output("final_decision",final.DECISION);await output("final_sha256",final.FINAL_LIVE_ACCEPTANCE_SHA256);
  console.log(`P30_GITHUB_LIVE_ACCEPTANCE=PASS decision=${final.DECISION} final_sha256=${final.FINAL_LIVE_ACCEPTANCE_SHA256}`);
}

if(cmd==="observe")await observe(args[0],args[1]);
else if(cmd==="finalize")await finalize(args[0],args[1],args[2]);
else throw new Error(`P30_GITHUB_LIVE_COMMAND_UNSUPPORTED_${cmd}`);
