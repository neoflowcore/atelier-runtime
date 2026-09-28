import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("P52_D0_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("P52_D0_UNSUPPORTED_CANONICAL_TYPE");
}

function digest(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function requireSha256(value, code) {
  if (!SHA256_RE.test(value ?? "")) throw new Error(code);
  return value;
}

function requireSha40(value, code) {
  if (!SHA40_RE.test(value ?? "")) throw new Error(code);
  return value;
}

function requireString(value, code) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

export function verifyRuntimeRev52HandoffV1({
  handoff,
  interfaceFreeze,
  developmentSeal,
  expectedHandoffDigest,
  expectedCarrierHead,
  expectedRuntimeSourceHead,
  expectedRuntimeSourceTree,
  expectedInterfaceDigest
} = {}) {
  if (!isObject(handoff) || handoff.SCHEMA_ID !== "RUNTIME_REV52_HANDOFF_BUNDLE_V1") {
    return Object.freeze({ ok: false, errors: ["RUNTIME_REV52_HANDOFF_REQUIRED"] });
  }
  if (!isObject(interfaceFreeze) || interfaceFreeze.SCHEMA_ID !== "RUNTIME_REV52_INTERFACE_FREEZE_V1") {
    return Object.freeze({ ok: false, errors: ["RUNTIME_REV52_INTERFACE_FREEZE_REQUIRED"] });
  }

  const errors = [];
  if (handoff.RUNTIME_HANDOFF_BUNDLE !== "SEALED") errors.push("RUNTIME_HANDOFF_NOT_SEALED");
  if (handoff.RUNTIME_TRACK_ENDS_AT_HANDOFF !== true) errors.push("RUNTIME_TRACK_TERMINAL_FLAG_MISSING");
  if (handoff.AUTO_ADVANCE_RUNTIME_TO_PILOTE !== false) errors.push("RUNTIME_AUTO_ADVANCE_MUST_BE_FALSE");
  if (handoff.runtimeVersion !== "5.2") errors.push("RUNTIME_VERSION_MISMATCH");
  if (handoff.runtimeInterfaceVersion !== "5.2-FROZEN") errors.push("RUNTIME_INTERFACE_VERSION_MISMATCH");
  if (!SHA256_RE.test(handoff.handoffDigest ?? "")) errors.push("RUNTIME_HANDOFF_DIGEST_INVALID");
  else {
    const { handoffDigest, ...body } = handoff;
    if (digest(body) !== handoffDigest) errors.push("RUNTIME_HANDOFF_DIGEST_MISMATCH");
  }

  if (expectedHandoffDigest && handoff.handoffDigest !== expectedHandoffDigest) errors.push("PINNED_HANDOFF_DIGEST_MISMATCH");
  if (expectedRuntimeSourceHead && handoff.runtimeSourceIdentity?.head !== expectedRuntimeSourceHead) errors.push("PINNED_RUNTIME_SOURCE_HEAD_MISMATCH");
  if (expectedRuntimeSourceTree && handoff.runtimeSourceIdentity?.tree !== expectedRuntimeSourceTree) errors.push("PINNED_RUNTIME_SOURCE_TREE_MISMATCH");
  if (expectedInterfaceDigest && handoff.runtimeInterfaceDigest !== expectedInterfaceDigest) errors.push("PINNED_RUNTIME_INTERFACE_DIGEST_MISMATCH");

  if (!SHA256_RE.test(interfaceFreeze.RUNTIME_INTERFACE_DIGEST ?? "")) errors.push("INTERFACE_FREEZE_DIGEST_INVALID");
  else {
    const { RUNTIME_INTERFACE_DIGEST, ...body } = interfaceFreeze;
    if (digest(body) !== RUNTIME_INTERFACE_DIGEST) errors.push("INTERFACE_FREEZE_DIGEST_MISMATCH");
  }
  if (interfaceFreeze.RUNTIME_INTERFACE_VERSION !== "5.2-FROZEN") errors.push("INTERFACE_FREEZE_VERSION_MISMATCH");
  if (handoff.runtimeInterfaceDigest !== interfaceFreeze.RUNTIME_INTERFACE_DIGEST) errors.push("HANDOFF_INTERFACE_BINDING_MISMATCH");
  if (!SHA40_RE.test(interfaceFreeze.qualifiedImplementationHead ?? "")) errors.push("INTERFACE_QUALIFIED_IMPLEMENTATION_HEAD_INVALID");

  if (developmentSeal !== undefined) {
    if (!isObject(developmentSeal) || developmentSeal.SCHEMA_ID !== "RUNTIME_REV52_DEVELOPMENT_SEAL_V1") errors.push("RUNTIME_DEVELOPMENT_SEAL_REQUIRED");
    else {
      if (!SHA256_RE.test(developmentSeal.RUNTIME_DEVELOPMENT_SEAL_SHA256 ?? "")) errors.push("RUNTIME_DEVELOPMENT_SEAL_SHA256_INVALID");
      else {
        const { RUNTIME_DEVELOPMENT_SEAL_SHA256, ...sealBody } = developmentSeal;
        if (digest(sealBody) !== RUNTIME_DEVELOPMENT_SEAL_SHA256) errors.push("RUNTIME_DEVELOPMENT_SEAL_SHA256_MISMATCH");
      }
      if (handoff.runtimeDevelopmentSealSha256 !== developmentSeal.RUNTIME_DEVELOPMENT_SEAL_SHA256) errors.push("HANDOFF_DEVELOPMENT_SEAL_BINDING_MISMATCH");
      if (handoff.runtimeSourceIdentity?.head !== developmentSeal.runtimeSourceHead) errors.push("HANDOFF_DEVELOPMENT_SEAL_SOURCE_HEAD_MISMATCH");
      if (handoff.runtimeSourceIdentity?.tree !== developmentSeal.runtimeSourceTree) errors.push("HANDOFF_DEVELOPMENT_SEAL_SOURCE_TREE_MISMATCH");
      if (handoff.runtimeInterfaceDigest !== developmentSeal.runtimeInterfaceDigest) errors.push("HANDOFF_DEVELOPMENT_SEAL_INTERFACE_MISMATCH");
      if (developmentSeal.RUNTIME_DEVELOPMENT_SEAL !== "PASS") errors.push("RUNTIME_DEVELOPMENT_SEAL_NOT_PASS");
    }
  }

  if (expectedCarrierHead !== undefined && !SHA40_RE.test(expectedCarrierHead)) errors.push("RUNTIME_HANDOFF_CARRIER_HEAD_INVALID");

  return Object.freeze({
    ok: errors.length === 0,
    errors,
    runtimeHandoffDigest: handoff.handoffDigest ?? null,
    runtimeInterfaceDigest: handoff.runtimeInterfaceDigest ?? null,
    runtimeSourceIdentity: handoff.runtimeSourceIdentity ?? null,
    runtimeCarrierHead: expectedCarrierHead ?? null,
    projectIdentityDigest: handoff.projectIdentityDigest ?? null,
    sourceManifestDigest: handoff.sourceManifestDigest ?? null
  });
}

export function compilePiloteRuntimeDependencyLockV1(input = {}) {
  requireSha256(input.runtimeHandoffDigest, "RUNTIME_HANDOFF_DIGEST_REQUIRED");
  requireSha256(input.runtimeInterfaceDigest, "RUNTIME_INTERFACE_DIGEST_REQUIRED");
  requireSha256(input.projectIdentityDigest, "PROJECT_IDENTITY_DIGEST_REQUIRED");
  requireSha256(input.sourceManifestDigest, "SOURCE_MANIFEST_DIGEST_REQUIRED");
  requireSha256(input.masterPlanDigest, "MASTER_PLAN_DIGEST_REQUIRED");
  requireSha40(input.runtimeSourceHead, "RUNTIME_SOURCE_HEAD_REQUIRED");
  requireSha40(input.runtimeSourceTree, "RUNTIME_SOURCE_TREE_REQUIRED");
  requireSha40(input.runtimeHandoffCarrierHead, "RUNTIME_HANDOFF_CARRIER_HEAD_REQUIRED");

  const body = {
    SCHEMA_ID: "PILOTE_RUNTIME_DEPENDENCY_LOCK_V1",
    SCHEMA_VERSION: "1",
    piloteVersion: "5.2",
    runtimeVersion: "5.2",
    runtimeHandoffDigest: input.runtimeHandoffDigest,
    runtimeHandoffCarrierHead: input.runtimeHandoffCarrierHead,
    runtimeSourceIdentity: {
      head: input.runtimeSourceHead,
      tree: input.runtimeSourceTree
    },
    runtimeInterfaceVersion: "5.2-FROZEN",
    runtimeInterfaceDigest: input.runtimeInterfaceDigest,
    projectIdentityDigest: input.projectIdentityDigest,
    sourceManifestDigest: input.sourceManifestDigest,
    authoritativeMasterPlanId: requireString(input.authoritativeMasterPlanId, "MASTER_PLAN_ID_REQUIRED"),
    masterPlanDigest: input.masterPlanDigest,
    compatibilityManifestRef: requireString(input.compatibilityManifestRef, "COMPATIBILITY_MANIFEST_REF_REQUIRED"),
    migrationManifestRef: requireString(input.migrationManifestRef, "MIGRATION_MANIFEST_REF_REQUIRED"),
    conformanceFixtureManifestRef: requireString(input.conformanceFixtureManifestRef, "CONFORMANCE_FIXTURE_MANIFEST_REF_REQUIRED"),
    runtimeSourceMutationAllowed: false,
    runtimeInterfaceRedefinitionAllowed: false,
    runtimeInlinePatchAllowed: false,
    providerSpecificImplementationAllowed: false,
    dependencyState: "LOCKED"
  };
  return Object.freeze({ ...body, DEPENDENCY_LOCK_SHA256: digest(body) });
}

export function validatePiloteRuntimeDependencyLockV1(lock) {
  if (!isObject(lock) || lock.SCHEMA_ID !== "PILOTE_RUNTIME_DEPENDENCY_LOCK_V1") {
    return Object.freeze({ ok: false, errors: ["PILOTE_RUNTIME_DEPENDENCY_LOCK_REQUIRED"] });
  }
  const errors = [];
  if (lock.dependencyState !== "LOCKED") errors.push("DEPENDENCY_NOT_LOCKED");
  if (lock.runtimeVersion !== "5.2" || lock.runtimeInterfaceVersion !== "5.2-FROZEN") errors.push("RUNTIME_DEPENDENCY_VERSION_MISMATCH");
  if (lock.runtimeSourceMutationAllowed !== false) errors.push("RUNTIME_SOURCE_MUTATION_MUST_BE_DENIED");
  if (lock.runtimeInterfaceRedefinitionAllowed !== false) errors.push("RUNTIME_INTERFACE_REDEFINITION_MUST_BE_DENIED");
  if (lock.runtimeInlinePatchAllowed !== false) errors.push("RUNTIME_INLINE_PATCH_MUST_BE_DENIED");
  if (lock.providerSpecificImplementationAllowed !== false) errors.push("PROVIDER_SPECIFIC_IMPLEMENTATION_MUST_BE_DENIED");
  if (!SHA256_RE.test(lock.DEPENDENCY_LOCK_SHA256 ?? "")) errors.push("DEPENDENCY_LOCK_SHA256_INVALID");
  else {
    const { DEPENDENCY_LOCK_SHA256, ...body } = lock;
    if (digest(body) !== DEPENDENCY_LOCK_SHA256) errors.push("DEPENDENCY_LOCK_SHA256_MISMATCH");
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}
