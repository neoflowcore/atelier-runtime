import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContinueAliasV1, compileMasterPlanExecutionGrantV1 } from "../runtime/rev51/master-plan-run-contract-v1.mjs";
import { decideContinuationV1 } from "../runtime/rev51/continuation-decision-v1.mjs";
import { evaluateAuthEndgameClosurePreflightV1 } from "../runtime/rev51/auth-endgame-transaction-v1.mjs";
import { buildEvidenceValidityGraphV1, invalidateEvidenceGraphV1 } from "../runtime/rev51/evidence-validity-graph-v1.mjs";
import { evaluateContentIdentityEvidenceReuseV1 } from "../runtime/rev51/content-identity-evidence-reuse-v1.mjs";
import { buildDependencySecurityObservationV1 } from "../runtime/rev51/dependency-security-observation-v1.mjs";
import {
  normalizePiloteAliasV1,
  evaluatePiloteResponseFinalizationV1,
  validateFrozenRuntimeInterfaceV1,
  bindPhaseExecutionGrantContinuationV1,
  compilePhaseRunContractV1,
  compileContinuationPolicyV1,
  compileMasterPlanSemanticContractV1
} from "../pilote/rev51/master-plan-semantics-v1.mjs";
import { consumeRuntimeEvidenceInvalidationV1, evaluateContentIdentityReuseAcceptanceV1, evaluateDependencySecurityPolicyV1 } from "../pilote/rev51/acceptance-policy-v1.mjs";
import { evaluateAuthEndgameBoundarySemanticsV1 } from "../pilote/rev51/auth-endgame-semantics-v1.mjs";

const H=x=>x.repeat(64);
const runtimeIdentity={
  runtimeInterfaceIdentitySha256:"39e686591f169e62416726518d1e6917a8ed3cded43b284e2d3a2216c546548b",
  runtimeCompatibilityIdentitySha256:"35cbae1c4a6d42b27a45e5faeba37fe3a86a319c6944a9eb046482dea3e59dec",
  runtimeContractSetSha256:"d72564952b8a57b8f494306e882817f366e8f14b8c6baf367a37fb16015412fa"
};

test("P29 Runtime and Pilote universal continue alias agree on operation",()=>{
  assert.equal(normalizeContinueAliasV1("ㅇㅇ").operation,normalizePiloteAliasV1("ㅇㅇ").operation);
  assert.equal(normalizePiloteAliasV1("ㅈㄱ").operation,normalizeContinueAliasV1("dd").operation);
});

test("P29 frozen Runtime identities match Pilote compile fence",()=>{
  assert.equal(validateFrozenRuntimeInterfaceV1(runtimeIdentity).ok,true);
});

test("P29 Runtime CONTINUE decision blocks Pilote final response",()=>{
  const d=decideContinuationV1({projectRemainingWork:true,executableOrAlternateLegalWork:true});
  assert.equal(d.decision,"CONTINUE");
  const p=evaluatePiloteResponseFinalizationV1(d);
  assert.equal(p.finalResponseAllowed,false);
  assert.equal(p.executeImmediately,true);
});

test("P29 Runtime invalidation receipt maps only affected Pilote acceptance nodes",()=>{
  const graph=buildEvidenceValidityGraphV1([
    {EVIDENCE_ID:"e1",STATUS:"VALID",DOMAINS:["SOURCE"],DEPENDS_ON:[]},
    {EVIDENCE_ID:"e2",STATUS:"VALID",DOMAINS:["LIVE"],DEPENDS_ON:["e1"]}
  ]);
  const inv=invalidateEvidenceGraphV1(graph,{evidenceIds:["e1"]});
  const p=consumeRuntimeEvidenceInvalidationV1({runtimeInvalidation:inv,acceptanceNodes:[{nodeId:"SOURCE",requiredEvidenceIds:["e1"]},{nodeId:"LIVE",requiredEvidenceIds:["e2"]},{nodeId:"CI",requiredEvidenceIds:["e3"]}]});
  assert.deepEqual(p.affectedAcceptanceNodes,["LIVE","SOURCE"]);
  assert.equal(p.fullRevalidationRequired,false);
});

test("P29 Runtime content identity reuse is accepted only when Runtime marks evidence reusable",()=>{
  const r=evaluateContentIdentityEvidenceReuseV1({qualifiedIdentity:{KIND:"GIT_TREE",VALUE:"abc"},acceptedIdentity:{KIND:"GIT_TREE",VALUE:"abc"},evidence:[{EVIDENCE_ID:"e1",DEPENDENCY_SCOPE:"CONTENT",STATUS:"PASS"},{EVIDENCE_ID:"e2",DEPENDENCY_SCOPE:"COMMIT_METADATA",STATUS:"PASS"}]});
  const p=evaluateContentIdentityReuseAcceptanceV1(r);
  assert.deepEqual(p.reusableEvidenceIds,["e1"]);
});

test("P29 Runtime dependency observation remains read-only input to Pilote policy",()=>{
  const o=buildDependencySecurityObservationV1({DEPENDENCY_GRAPH_DIGEST:H("1"),SCANNER_ID:"scanner",SCANNER_POLICY_VERSION:"1",ADVISORY_IDS:[],SEVERITY_COUNTS:{CRITICAL:0,HIGH:1},SCAN_TIMESTAMP:"2026-09-27T00:00:00Z"});
  assert.equal(o.MUTATION_AUTHORITY,false);
  assert.equal(evaluateDependencySecurityPolicyV1({observation:o,policy:{maxCritical:0,maxHigh:1}}).decision,"RELEASE");
});

test("P29 Runtime and Pilote both defer auth before project development complete",()=>{
  assert.equal(evaluateAuthEndgameClosurePreflightV1({projectDevelopmentComplete:false,unresolvedRequirementCount:2}).decision,"DEFER_AUTH_CONTINUE_DEVELOPMENT");
  assert.equal(evaluateAuthEndgameBoundarySemanticsV1({projectDevelopmentComplete:false,unresolvedRequirementCount:2}).decision,"DEFER_AUTH_CONTINUE_DEVELOPMENT");
});

test("P29 Runtime and Pilote converge on one aggregated auth boundary after project completion",()=>{
  assert.equal(evaluateAuthEndgameClosurePreflightV1({projectDevelopmentComplete:true,unresolvedRequirementCount:2,interactivePromptCount:0}).decision,"ONE_AGGREGATED_AUTH_BOUNDARY");
  assert.equal(evaluateAuthEndgameBoundarySemanticsV1({projectDevelopmentComplete:true,unresolvedRequirementCount:2,interactivePromptCount:0}).decision,"ONE_AGGREGATED_AUTH_BOUNDARY");
});

test("P29 execution grant continuation binds without reapproval",()=>{
  const semantic=compileMasterPlanSemanticContractV1({...runtimeIdentity,projectId:"ephemdrop",masterPlanId:"v017",masterPlanManifestSha256:H("4"),masterPlanExecutionGrantSha256:H("5")});
  const phase=compilePhaseRunContractV1({phaseId:"P29",masterPlanSemanticContractSha256:semantic.SEMANTIC_CONTRACT_SHA256,developmentBranch:"runtime-r51-p8-dependency-lock-cache"});
  const policy=compileContinuationPolicyV1({masterPlanSemanticContractSha256:semantic.SEMANTIC_CONTRACT_SHA256,projectRemainingWork:true});
  const runtimeGrant=compileMasterPlanExecutionGrantV1({GRANT_ID:"g",PROJECT_IDENTITY_DIGEST:H("6"),PLAN_MANIFEST_DIGEST:H("7"),APPROVED_HOST_SCOPE:"neoflowcore/atelier-runtime",DEVELOPMENT_BRANCH:"runtime-r51-p8-dependency-lock-cache"});
  const r=bindPhaseExecutionGrantContinuationV1({grant:runtimeGrant,phaseRunContract:phase,continuationPolicy:policy});
  assert.equal(r.ok,true);
  assert.equal(r.reapprovalRequired,false);
});
