import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const RUN_STATES = new Set(["ACTIVE", "PAUSED", "COMPLETE"]);
const AUTH_STATES = new Set(["DEFERRED", "READY", "EXECUTABLE", "COMPLETE"]);
const DEFERRED_KINDS = new Set(["AUTH", "PROVIDER_LIVE", "PAID_RESOURCE", "FINAL_MERGE_RELEASE"]);

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("PROJECT_RUN_STATE_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("PROJECT_RUN_STATE_UNSUPPORTED_CANONICAL_TYPE");
}
function hash(value) { return createHash("sha256").update(canonicalize(value), "utf8").digest("hex"); }
function requireSha(value, code) { if (!SHA256_RE.test(value ?? "")) throw new Error(code); return value; }
function requireString(value, code) { if (typeof value !== "string" || !value) throw new Error(code); return value; }
function uniqueSortedStrings(values, code) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) throw new Error(code);
  return [...new Set(values)].sort();
}
function normalizeBindings(values, code) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values) || values.some((value) => !isObject(value))) throw new Error(code);
  return values.map((value) => ({ ...value }));
}
function normalizeDeferredItem(item, fallbackKind = null) {
  if (!isObject(item)) throw new Error("DEFERRED_ITEM_INVALID");
  const kind = item.kind ?? fallbackKind;
  if (!DEFERRED_KINDS.has(kind)) throw new Error("DEFERRED_ITEM_KIND_INVALID");
  return { id: requireString(item.id, "DEFERRED_ITEM_ID_REQUIRED"), kind, phaseId: item.phaseId ?? null, reason: item.reason ?? null };
}
function sortDeferred(values) { return [...values].sort((a,b)=>(a.phaseId??"").localeCompare(b.phaseId??"")||a.id.localeCompare(b.id)); }

export function compileProjectRunStateV2(input = {}) {
  const body = {
    SCHEMA_ID: "PROJECT_RUN_STATE_V2",
    SCHEMA_VERSION: "2",
    projectIdentityDigest: requireSha(input.projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED"),
    authoritativePlanSetDigest: requireSha(input.authoritativePlanSetDigest, "AUTHORITATIVE_PLAN_SET_DIGEST_REQUIRED"),
    sourceManifestDigest: requireSha(input.sourceManifestDigest, "SOURCE_MANIFEST_DIGEST_REQUIRED"),
    runId: requireString(input.runId, "RUN_ID_REQUIRED"),
    runState: input.runState ?? "ACTIVE",
    runtimeInterfaceVersion: input.runtimeInterfaceVersion ?? "5.2-DEVELOPMENT",
    currentDevelopmentBranch: requireString(input.currentDevelopmentBranch, "DEVELOPMENT_BRANCH_REQUIRED"),
    currentSourceIdentity: isObject(input.currentSourceIdentity) ? { ...input.currentSourceIdentity } : null,
    activePhaseId: input.activePhaseId ?? null,
    completedNodes: uniqueSortedStrings(input.completedNodes, "COMPLETED_NODES_INVALID"),
    acceptedEvidenceRefs: uniqueSortedStrings(input.acceptedEvidenceRefs, "ACCEPTED_EVIDENCE_REFS_INVALID"),
    invalidatedEvidenceRefs: uniqueSortedStrings(input.invalidatedEvidenceRefs, "INVALIDATED_EVIDENCE_REFS_INVALID"),
    ACTIVE_NEXT: input.ACTIVE_NEXT ?? null,
    DEFERRED_AUTH_NEXT: input.DEFERRED_AUTH_NEXT ? normalizeDeferredItem(input.DEFERRED_AUTH_NEXT, "AUTH") : null,
    DEFERRED_PROVIDER_LIVE_WORK: sortDeferred((input.DEFERRED_PROVIDER_LIVE_WORK ?? []).map((item)=>normalizeDeferredItem(item,"PROVIDER_LIVE"))),
    DEFERRED_PAID_RESOURCE_WORK: sortDeferred((input.DEFERRED_PAID_RESOURCE_WORK ?? []).map((item)=>normalizeDeferredItem(item,"PAID_RESOURCE"))),
    DEFERRED_FINAL_MERGE_RELEASE_WORK: sortDeferred((input.DEFERRED_FINAL_MERGE_RELEASE_WORK ?? []).map((item)=>normalizeDeferredItem(item,"FINAL_MERGE_RELEASE"))),
    authEndgameState: input.authEndgameState ?? "DEFERRED",
    providerAuthorityBindings: normalizeBindings(input.providerAuthorityBindings, "PROVIDER_AUTHORITY_BINDINGS_INVALID"),
    executionSurfaceBindings: normalizeBindings(input.executionSurfaceBindings, "EXECUTION_SURFACE_BINDINGS_INVALID"),
    mutationAuthorityEnvelope: input.mutationAuthorityEnvelope ?? null,
    billingResidueState: input.billingResidueState ?? { activePaidCompute: 0, orphanedBillableResource: 0, billableResidue: 0 },
    lastDurableCheckpoint: input.lastDurableCheckpoint ?? null
  };
  if (!RUN_STATES.has(body.runState)) throw new Error("RUN_STATE_INVALID");
  if (!AUTH_STATES.has(body.authEndgameState)) throw new Error("AUTH_ENDGAME_STATE_INVALID");
  return Object.freeze({ ...body, PROJECT_RUN_STATE_SHA256: hash(body) });
}

export function validateProjectRunStateV2(state) {
  if (!isObject(state) || state.SCHEMA_ID !== "PROJECT_RUN_STATE_V2" || state.SCHEMA_VERSION !== "2") return Object.freeze({ ok:false, errors:["PROJECT_RUN_STATE_V2_REQUIRED"] });
  const errors=[];
  for (const [value,code] of [[state.projectIdentityDigest,"PROJECT_IDENTITY_DIGEST_INVALID"],[state.authoritativePlanSetDigest,"AUTHORITATIVE_PLAN_SET_DIGEST_INVALID"],[state.sourceManifestDigest,"SOURCE_MANIFEST_DIGEST_INVALID"],[state.PROJECT_RUN_STATE_SHA256,"PROJECT_RUN_STATE_SHA256_INVALID"]]) if(!SHA256_RE.test(value??"")) errors.push(code);
  if(!RUN_STATES.has(state.runState)) errors.push("RUN_STATE_INVALID");
  if(!AUTH_STATES.has(state.authEndgameState)) errors.push("AUTH_ENDGAME_STATE_INVALID");
  if(errors.length===0){ const { PROJECT_RUN_STATE_SHA256,...body}=state; if(hash(body)!==PROJECT_RUN_STATE_SHA256) errors.push("PROJECT_RUN_STATE_SHA256_MISMATCH");}
  return Object.freeze({ok:errors.length===0,errors});
}

export function migrateLegacyNextToProjectRunStateV2({ legacyState = {}, baseState, credentialIndependentActions = [] } = {}) {
  if (!isObject(baseState)) throw new Error("BASE_STATE_REQUIRED");
  if (!Array.isArray(credentialIndependentActions)) throw new Error("CREDENTIAL_INDEPENDENT_ACTIONS_REQUIRED");
  const available=credentialIndependentActions.filter((action)=>isObject(action)&&typeof action.id==="string"&&action.id&&action.status!=="COMPLETE").sort((a,b)=>(a.order??Number.MAX_SAFE_INTEGER)-(b.order??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id));
  const legacyNext=isObject(legacyState.NEXT)?legacyState.NEXT:null;
  const deferred={auth:baseState.DEFERRED_AUTH_NEXT??null,provider:[...(baseState.DEFERRED_PROVIDER_LIVE_WORK??[])],paid:[...(baseState.DEFERRED_PAID_RESOURCE_WORK??[])],merge:[...(baseState.DEFERRED_FINAL_MERGE_RELEASE_WORK??[])]};
  let legacyNextDisposition="NONE";
  if(legacyNext&&DEFERRED_KINDS.has(legacyNext.kind)){
    const normalized=normalizeDeferredItem(legacyNext); legacyNextDisposition=`DEFERRED_${normalized.kind}`;
    if(normalized.kind==="AUTH") deferred.auth=normalized;
    if(normalized.kind==="PROVIDER_LIVE") deferred.provider.push(normalized);
    if(normalized.kind==="PAID_RESOURCE") deferred.paid.push(normalized);
    if(normalized.kind==="FINAL_MERGE_RELEASE") deferred.merge.push(normalized);
  }
  const active=available[0]??null;
  const migrated=compileProjectRunStateV2({...baseState,ACTIVE_NEXT:active?{id:active.id,kind:active.kind??"SOURCE",phaseId:active.phaseId??null}:baseState.ACTIVE_NEXT??null,DEFERRED_AUTH_NEXT:deferred.auth,DEFERRED_PROVIDER_LIVE_WORK:deferred.provider,DEFERRED_PAID_RESOURCE_WORK:deferred.paid,DEFERRED_FINAL_MERGE_RELEASE_WORK:deferred.merge,authEndgameState:active?"DEFERRED":(baseState.authEndgameState??"DEFERRED")});
  const receiptBody={SCHEMA_ID:"PROJECT_RUN_STATE_V2_MIGRATION_RECEIPT",SCHEMA_VERSION:"1",sourceSchema:legacyState.SCHEMA_ID??"LEGACY_UNKNOWN",legacyNextDisposition,activeNextId:migrated.ACTIVE_NEXT?.id??null,legacyNextAuthOverrodeSource:false,duplicateExecutionAllowed:false,migratedStateSha256:migrated.PROJECT_RUN_STATE_SHA256};
  return Object.freeze({state:migrated,receipt:Object.freeze({...receiptBody,MIGRATION_RECEIPT_SHA256:hash(receiptBody)})});
}
