import test from "node:test";
import assert from "node:assert/strict";
import { computeRev51ObjectHash } from "../runtime/rev51/contract-core.mjs";
import { acceptQuarantinedResultV1 } from "../runtime/rev51/result-quarantine-acceptance-v1.mjs";

function plan() {
  const value = {
    SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: "1".repeat(64),
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_TRANSPORT: "DIRECT_WORKER"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}

function workerJob(p = plan()) {
  const value = {
    SCHEMA_ID: "WORKER_JOB_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1",
    UPSTREAM_OBJECT_SHA256: p.OBJECT_SHA256,
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_PLAN_HASH: p.OBJECT_SHA256,
    EXECUTION_ID: "exec-001",
    ATTEMPT_ID: "attempt-001",
    FENCE_TOKEN: "fence-001"
  };
  value.OBJECT_SHA256 = computeRev51ObjectHash(value);
  return value;
}

function artifact(id, sha) {
  return {
    ARTIFACT_ID: id,
    CONTENT_SHA256: sha,
    SIZE_BYTES: 10,
    MEDIA_TYPE: "application/octet-stream",
    STORAGE_CLASS: "RUNTIME_LOCAL",
    SECURITY_DOMAIN: "DEFAULT",
    ORIGIN_EXECUTION_ID: "exec-001",
    CREATED_AT: "2026-09-20T00:00:00Z",
    RETENTION_CLASS: "UNTIL_FINAL_ACCEPTANCE",
    LOCATIONS: [`runtime://${id}`],
    ARTIFACT_STATE: "QUARANTINED"
  };
}

function verification(p, w, artifacts) {
  return {
    VERIFICATION_RESULT: "PASS",
    EXECUTION_ID: w.EXECUTION_ID,
    ATTEMPT_ID: w.ATTEMPT_ID,
    FENCE_TOKEN: w.FENCE_TOKEN,
    WORKER_JOB_HASH: w.OBJECT_SHA256,
    EXECUTION_PLAN_HASH: p.OBJECT_SHA256,
    CONTENT_VERIFIED: true,
    FENCE_VERIFIED: true,
    WORKER_JOB_VERIFIED: true,
    EXECUTION_PLAN_VERIFIED: true,
    SECURITY_OUTPUT_CONTRACT_VERIFIED: true,
    ARTIFACT_CONTENT_BINDINGS: artifacts.map((a) => ({ ARTIFACT_ID: a.ARTIFACT_ID, CONTENT_SHA256: a.CONTENT_SHA256 }))
  };
}

function validSet() {
  const p = plan();
  const w = workerJob(p);
  const artifacts = [artifact("artifact-b", "b".repeat(64)), artifact("artifact-a", "a".repeat(64))];
  return { p, w, artifacts, v: verification(p, w, artifacts) };
}

test("quarantined artifacts are atomically accepted as immutable", () => {
  const { p, w, artifacts, v } = validSet();
  const out = acceptQuarantinedResultV1(p, w, artifacts, v);
  assert.deepEqual(out.receipt.ACCEPTED_ARTIFACT_IDS, ["artifact-a", "artifact-b"]);
  assert.ok(out.acceptedArtifacts.every((a) => a.ARTIFACT_STATE === "IMMUTABLE"));
  assert.equal(out.receipt.RUNTIME_SEALED, true);
  assert.equal(out.receipt.WORKER_JOB_HASH, w.OBJECT_SHA256);
  assert.equal(out.receipt.EXECUTION_PLAN_HASH, p.OBJECT_SHA256);
});

test("acceptance is deterministic for identical semantic inputs", () => {
  const a = validSet();
  const b = validSet();
  assert.deepEqual(acceptQuarantinedResultV1(a.p, a.w, a.artifacts, a.v), acceptQuarantinedResultV1(b.p, b.w, b.artifacts, b.v));
});

test("input artifacts remain quarantined and are not mutated", () => {
  const { p, w, artifacts, v } = validSet();
  acceptQuarantinedResultV1(p, w, artifacts, v);
  assert.ok(artifacts.every((a) => a.ARTIFACT_STATE === "QUARANTINED"));
});

test("stale fence verification is rejected", () => {
  const { p, w, artifacts, v } = validSet();
  v.FENCE_TOKEN = "stale-fence";
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /VERIFICATION_FENCE_TOKEN_MISMATCH/);
});

test("worker job exact plan hash binding is required", () => {
  const { p, w, artifacts, v } = validSet();
  w.EXECUTION_PLAN_HASH = "f".repeat(64);
  w.OBJECT_SHA256 = computeRev51ObjectHash(w);
  v.WORKER_JOB_HASH = w.OBJECT_SHA256;
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /WORKER_JOB_EXECUTION_PLAN_HASH_MISMATCH/);
});

test("tampered worker job object hash is rejected", () => {
  const { p, w, artifacts, v } = validSet();
  w.ATTEMPT_ID = "tampered";
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /OBJECT_SHA256_MISMATCH/);
});

test("non-quarantined artifact cannot be accepted", () => {
  const { p, w, artifacts, v } = validSet();
  artifacts[0].ARTIFACT_STATE = "STAGING";
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /ARTIFACT_NOT_QUARANTINED/);
});

test("artifact origin must bind exact execution", () => {
  const { p, w, artifacts, v } = validSet();
  artifacts[0].ORIGIN_EXECUTION_ID = "exec-other";
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /ARTIFACT_ORIGIN_EXECUTION_ID_MISMATCH/);
});

test("content digest proof must match each artifact", () => {
  const { p, w, artifacts, v } = validSet();
  v.ARTIFACT_CONTENT_BINDINGS[0].CONTENT_SHA256 = "c".repeat(64);
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /ARTIFACT_CONTENT_BINDING_MISMATCH/);
});

test("security/output contract verification is mandatory", () => {
  const { p, w, artifacts, v } = validSet();
  v.SECURITY_OUTPUT_CONTRACT_VERIFIED = false;
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /RESULT_ACCEPTANCE_CHECK_FAILED:SECURITY_OUTPUT_CONTRACT_VERIFIED/);
});

test("duplicate artifact ids fail before acceptance", () => {
  const { p, w, artifacts, v } = validSet();
  artifacts[1].ARTIFACT_ID = artifacts[0].ARTIFACT_ID;
  v.ARTIFACT_CONTENT_BINDINGS = artifacts.map((a) => ({ ARTIFACT_ID: a.ARTIFACT_ID, CONTENT_SHA256: a.CONTENT_SHA256 }));
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /ARTIFACT_ID_DUPLICATE/);
});

test("verification result must PASS for atomic acceptance", () => {
  const { p, w, artifacts, v } = validSet();
  v.VERIFICATION_RESULT = "FAIL";
  assert.throws(() => acceptQuarantinedResultV1(p, w, artifacts, v), /RESULT_VERIFICATION_MUST_PASS/);
});
