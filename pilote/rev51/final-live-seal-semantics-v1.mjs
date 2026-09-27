import { createHash } from "node:crypto";

const PASS = new Set(["PASS", "PASS_REUSED", "ACCEPTED", "QUALIFIED", "CLOSED", "ZERO"]);
const SHA = /^[0-9a-f]{64}$/;
function obj(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function canon(v){if(v===null)return"null";if(typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);if(typeof v==="number"){if(!Number.isSafeInteger(v))throw new Error("FINAL_SEAL_NON_SAFE_INTEGER");return JSON.stringify(v)}if(Array.isArray(v))return`[${v.map(canon).join(",")}]`;if(obj(v))return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;throw new Error("FINAL_SEAL_UNSUPPORTED_TYPE")}
const hash=v=>createHash("sha256").update(canon(v),"utf8").digest("hex");
function status(v){if(typeof v==="boolean")return v;return PASS.has(v)}

export function compileFinalLiveAcceptanceSemanticsV1(input={}) {
  if (!SHA.test(input.runtimeInterfaceIdentitySha256??"")) throw new Error("RUNTIME_INTERFACE_IDENTITY_REQUIRED");
  if (!SHA.test(input.runtimeCompatibilityIdentitySha256??"")) throw new Error("RUNTIME_COMPATIBILITY_IDENTITY_REQUIRED");
  const checks={
    PROJECT_DEVELOPMENT_COMPLETE: input.projectDevelopmentComplete===true,
    AUTH_ENDGAME_CLOSURE_COMPLETE: input.authEndgameClosureComplete===true,
    FINAL_AUTH_MANIFEST_SEALED: input.finalAuthManifestState==="SEALED_FOR_BIND",
    LIVE_PREFLIGHT: status(input.livePreflight),
    SOURCE_PROVENANCE: status(input.sourceProvenance),
    BINDING_IDENTITY: status(input.bindingIdentity),
    PRODUCTION_ATTESTATION: status(input.productionAttestation),
    FAILURE_QUALIFICATION: status(input.failureQualification),
    PROVIDER_QUALIFICATION: status(input.providerQualification),
    CANONICAL_EVIDENCE: status(input.canonicalEvidence),
    CLEANUP_CLOSURE: status(input.cleanupClosure),
    BILLABLE_RESIDUE_ZERO: input.unexpectedBillableResidue===0,
    AUTH_RESIDUE_CLEAN: status(input.authResidueClean),
    PROJECT_ACCEPTANCE: status(input.projectAcceptance)
  };
  const missing=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k).sort();
  const liveAccepted=missing.length===0;
  const releaseGranted=input.releaseAcceptanceGranted===true;
  const decision=!liveAccepted?"LIVE_ACCEPTANCE_PENDING":releaseGranted?"FINAL_LIVE_SEAL":"MERGE_READY_AWAITING_RELEASE_AUTHORITY";
  const body={
    SCHEMA_ID:"PILOTE_FINAL_LIVE_ACCEPTANCE_SEMANTICS_V1",SCHEMA_VERSION:"1",
    RUNTIME_INTERFACE_IDENTITY_SHA256:input.runtimeInterfaceIdentitySha256,
    RUNTIME_COMPATIBILITY_IDENTITY_SHA256:input.runtimeCompatibilityIdentitySha256,
    CHECKS:checks,MISSING:missing,
    LIVE_ACCEPTED:liveAccepted,
    RELEASE_ACCEPTANCE_GRANTED:releaseGranted,
    DECISION:decision,
    PROJECT_COMPLETE:decision==="FINAL_LIVE_SEAL",
    FINAL_RESPONSE_ALLOWED:decision==="FINAL_LIVE_SEAL"
  };
  return Object.freeze({...body,FINAL_LIVE_ACCEPTANCE_SHA256:hash(body)});
}

export function evaluateFinalMergeBoundaryV1(input={}) {
  if (input.liveAcceptanceDecision!=="MERGE_READY_AWAITING_RELEASE_AUTHORITY") return Object.freeze({boundary:false,decision:"NO_RELEASE_BOUNDARY"});
  if (input.releaseAuthorityAlreadyGranted===true) return Object.freeze({boundary:false,decision:"CONTINUE_FINAL_MERGE"});
  return Object.freeze({boundary:true,decision:"FINAL_RELEASE_MERGE_AUTHORITY_REQUIRED"});
}
