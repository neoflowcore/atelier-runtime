import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRev51ObjectHash,
  validateContractEnvelope,
  validateExecutionAxes,
  validateExecutionInputMode,
  validateRev5FrozenBaseline,
  REV51_INTERFACE_MANIFEST_SHA256,
  REV51_TASK_CONTRACT_SCHEMA_SHA256,
  REV51_TASK_CONTRACT_MACHINE_SCHEMA_SHA256
} from "../runtime/rev51/contract-core.mjs";

const H = "a".repeat(64);

function frozenBaseline(overrides = {}) {
  return {
    INTERFACE_VERSION: "1.0.0",
    INTERFACE_MANIFEST_SHA256: REV51_INTERFACE_MANIFEST_SHA256,
    TASK_CONTRACT_SCHEMA_SHA256: REV51_TASK_CONTRACT_SCHEMA_SHA256,
    TASK_CONTRACT_MACHINE_SCHEMA_SHA256: REV51_TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
    FROZEN_FIELDS: 27,
    TASK_CONTRACT_V1_MUTATION: 0,
    INTERFACE_V1_MUTATION: 0,
    ...overrides
  };
}

test("Rev5 frozen baseline exact values pass", () => {
  assert.deepEqual(validateRev5FrozenBaseline(frozenBaseline()), { ok: true, errors: [] });
});

test("Task Contract V1 mutation fails closed", () => {
  assert.ok(validateRev5FrozenBaseline(frozenBaseline({ TASK_CONTRACT_V1_MUTATION: 1 })).errors.includes("TASK_CONTRACT_V1_MUTATED"));
});

test("compute provider, execution transport and verifier policy remain independent", () => {
  assert.deepEqual(validateExecutionAxes({
    COMPUTE_PROVIDER: "DIGITALOCEAN",
    EXECUTION_TRANSPORT: "GITHUB_SELF_HOSTED_JIT",
    VERIFIER_POLICY: "RUNTIME_PLUS_PROJECT_CI"
  }), { ok: true, errors: [] });
});

test("GitHub self-hosted JIT is never accepted as compute provider", () => {
  assert.ok(validateExecutionAxes({
    COMPUTE_PROVIDER: "GITHUB_SELF_HOSTED_JIT",
    EXECUTION_TRANSPORT: "GITHUB_SELF_HOSTED_JIT",
    VERIFIER_POLICY: "PROJECT_CI_REQUIRED"
  }).errors.includes("UNSUPPORTED_COMPUTE_PROVIDER"));
});

test("legacy execution requires exact compatibility profile and no Rev5.1 intent", () => {
  assert.deepEqual(validateExecutionInputMode({ INPUT_MODE: "LEGACY_COMPAT", COMPAT_PROFILE_SHA256: H }), { ok: true, errors: [] });
  assert.ok(validateExecutionInputMode({ INPUT_MODE: "LEGACY_COMPAT", COMPAT_PROFILE_SHA256: H, EXECUTION_INTENT_SHA256: H }).errors.includes("LEGACY_TO_REV51_INTENT_SYNTHESIS_DENY"));
});

test("native Rev5.1 execution requires intent and forbids legacy downgrade", () => {
  assert.deepEqual(validateExecutionInputMode({ INPUT_MODE: "NATIVE_REV51", EXECUTION_INTENT_SHA256: H }), { ok: true, errors: [] });
  assert.ok(validateExecutionInputMode({ INPUT_MODE: "NATIVE_REV51", EXECUTION_INTENT_SHA256: H, COMPAT_PROFILE_SHA256: H }).errors.includes("REV51_TO_LEGACY_DOWNGRADE_DENY"));
});

test("immutable envelope binds exact upstream hash and self hash", () => {
  const envelope = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: H,
    NOTE: "opaque runtime-owned execution control metadata"
  };
  envelope.OBJECT_SHA256 = computeRev51ObjectHash(envelope);
  assert.deepEqual(validateContractEnvelope(envelope, {
    schemaId: "RUNTIME_EXECUTION_PLAN_V1",
    schemaVersion: "1",
    canonicalizationId: "ATELIER_REV51_JCS_V1",
    upstreamObjectSha256: H
  }), { ok: true, errors: [] });
});

test("old plan plus new intent fails exact upstream binding", () => {
  const envelope = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: H
  };
  envelope.OBJECT_SHA256 = computeRev51ObjectHash(envelope);
  const result = validateContractEnvelope(envelope, { upstreamObjectSha256: "b".repeat(64) });
  assert.ok(result.errors.includes("UPSTREAM_OBJECT_SHA256_MISMATCH"));
});
