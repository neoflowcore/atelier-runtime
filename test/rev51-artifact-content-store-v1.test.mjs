import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { stageArtifactContentV1, readArtifactContentV1, sealStagedArtifactContentV1 } from "../runtime/rev51/artifact-content-store-v1.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
test("quarantine validates bytes and isolates security domains", async () => {
  const root = await mkdtemp(join(tmpdir(), "r51-cas-"));
  const bytes = Buffer.from("exact artifact bytes");
  const record = { ARTIFACT_ID: "a", CONTENT_SHA256: sha(bytes), SIZE_BYTES: bytes.length, SECURITY_DOMAIN: "project-a" };
  try {
    await assert.rejects(stageArtifactContentV1(root, record, Buffer.from("wrong")), /ARTIFACT_CONTENT_MISMATCH/);
    const first = await stageArtifactContentV1(root, record, bytes);
    assert.equal(first.replay, false);
    assert.equal((await stageArtifactContentV1(root, record, bytes)).replay, true);
    assert.deepEqual(await readArtifactContentV1(root, record), bytes);
    await assert.rejects(readArtifactContentV1(root, { ...record, SECURITY_DOMAIN: "project-b" }), { code: "ENOENT" });
    await assert.rejects(sealStagedArtifactContentV1(root, record), /ARTIFACT_NOT_QUARANTINED/);

    await writeFile(first.path, "tampered");
    await assert.rejects(readArtifactContentV1(root, record), /ARTIFACT_CONTENT_MISMATCH/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("invalid domain cannot escape storage root", async () => {
  const b = Buffer.from("a");
  await assert.rejects(stageArtifactContentV1("/tmp/store", { ARTIFACT_ID: "a", CONTENT_SHA256: sha(b), SIZE_BYTES: 1, SECURITY_DOMAIN: "../escape" }, b), /ARTIFACT_SECURITY_DOMAIN_INVALID/);
});
test("concurrent writers converge on one verified object", async () => {
  const root = await mkdtemp(join(tmpdir(), "r51-cas-race-"));
  const bytes = Buffer.from("race payload");
  const record = { ARTIFACT_ID: "race", CONTENT_SHA256: sha(bytes), SIZE_BYTES: bytes.length, SECURITY_DOMAIN: "project-a" };
  try {
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => stageArtifactContentV1(root, record, bytes)));
    assert.equal(outcomes.filter(x => !x.replay).length, 1);
    assert.deepEqual(await readArtifactContentV1(root, record), bytes);
    const sealed = await Promise.all(Array.from({ length: 12 }, () => sealStagedArtifactContentV1(root, { ...record, ARTIFACT_STATE: "QUARANTINED" })));
    assert.equal(sealed.filter(x => !x.replay).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("durable acceptance binds immutable content read and rejects journal tampering", async () => {
  const { computeRev51ObjectHash } = await import("../runtime/rev51/contract-core.mjs");
  const { initializeDurableExecutionStateV1 } = await import("../runtime/rev51/durable-execution-state-v1.mjs");
  const { commitStoredResultAcceptanceV1 } = await import("../runtime/rev51/stored-result-acceptance-v1.mjs");
  const { readAcceptedArtifactContentV1 } = await import("../runtime/rev51/artifact-content-store-v1.mjs");
  const dir = await mkdtemp(join(tmpdir(), "r51-cas-acceptance-"));
  const b = Buffer.from("accepted");
  const t = Date.parse("2026-09-24T00:00:00Z");
  const enveloped = v => ({ ...v, OBJECT_SHA256: computeRev51ObjectHash({ ...v, OBJECT_SHA256: "0".repeat(64) }) });
  const plan = enveloped({ SCHEMA_ID: "RUNTIME_EXECUTION_PLAN_V1", SCHEMA_VERSION: "1", CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1", UPSTREAM_OBJECT_SHA256: "1".repeat(64), OBJECT_SHA256: "0".repeat(64), EXECUTION_TRANSPORT: "DIRECT_WORKER" });
  const job = enveloped({ SCHEMA_ID: "WORKER_JOB_V1", SCHEMA_VERSION: "1", CANONICALIZATION_ID: "ATELIER_REV51_JCS_V1", UPSTREAM_OBJECT_SHA256: plan.OBJECT_SHA256, OBJECT_SHA256: "0".repeat(64), EXECUTION_PLAN_HASH: plan.OBJECT_SHA256, EXECUTION_ID: "exec-1", ATTEMPT_ID: "attempt-1", FENCE_TOKEN: "fence-1" });
  const a = { ARTIFACT_ID: "artifact-1", CONTENT_SHA256: sha(b), SIZE_BYTES: b.length, MEDIA_TYPE: "application/octet-stream", STORAGE_CLASS: "RUNTIME_LOCAL", SECURITY_DOMAIN: "project-a", ORIGIN_EXECUTION_ID: "exec-1", CREATED_AT: "2026-09-24T00:00:00Z", RETENTION_CLASS: "UNTIL_FINAL_ACCEPTANCE", LOCATIONS: ["runtime://artifact-1"], ARTIFACT_STATE: "QUARANTINED" };
  try {
    const state = join(dir, "state.json");
    await initializeDurableExecutionStateV1(state, { EXECUTION_ID: "exec-1", EXECUTION_EPOCH: 2, ATTEMPT_ID: "attempt-1", LEASE_GENERATION: 4, FENCE_SEQUENCE: 1, FENCE_TOKEN: "fence-1", DESIRED_STATE: "RUNNING", MATERIALIZED_STATE: "RESULT_QUARANTINED", PROVIDER_OPERATION_STATE: "SUCCEEDED" }, t);
    const staged = await stageArtifactContentV1(dir, a, b);
    const v = { VERIFICATION_RESULT: "PASS", EXECUTION_ID: "exec-1", ATTEMPT_ID: "attempt-1", FENCE_TOKEN: "fence-1", WORKER_JOB_HASH: job.OBJECT_SHA256, EXECUTION_PLAN_HASH: plan.OBJECT_SHA256, CONTENT_VERIFIED: true, FENCE_VERIFIED: true, WORKER_JOB_VERIFIED: true, EXECUTION_PLAN_VERIFIED: true, SECURITY_OUTPUT_CONTRACT_VERIFIED: true, ARTIFACT_CONTENT_BINDINGS: [{ ARTIFACT_ID: a.ARTIFACT_ID, CONTENT_SHA256: a.CONTENT_SHA256 }] };
    await writeFile(staged.path, "tampered");
    await assert.rejects(commitStoredResultAcceptanceV1(dir, state, join(dir, "acceptance.json"), { IDEMPOTENCY_KEY: "bad", QUARANTINED_ARTIFACTS: [a] }), /ARTIFACT_CONTENT_MISMATCH/);
    await writeFile(staged.path, b);
    await assert.rejects(commitStoredResultAcceptanceV1(dir, state, join(dir, "acceptance.json"), { IDEMPOTENCY_KEY: "stale", EXPECTED_STATE_VERSION: 0, EXPECTED_EXECUTION_EPOCH: 2, EXPECTED_LEASE_GENERATION: 4, SUBMITTED_FENCE_TOKEN: "stale", RUNTIME_NOW_MS: t, PLAN: plan, WORKER_JOB: job, QUARANTINED_ARTIFACTS: [a], VERIFICATION: v }), /STALE_FENCE/);
    assert.deepEqual(await readArtifactContentV1(dir, a, "immutable"), b);
    await assert.rejects(readAcceptedArtifactContentV1(dir, {}, a.ARTIFACT_ID), /ARTIFACT_ACCEPTANCE_INVALID/);
    const out = await commitStoredResultAcceptanceV1(dir, state, join(dir, "acceptance.json"), { IDEMPOTENCY_KEY: "accept-1", EXPECTED_STATE_VERSION: 0, EXPECTED_EXECUTION_EPOCH: 2, EXPECTED_LEASE_GENERATION: 4, SUBMITTED_FENCE_TOKEN: "fence-1", RUNTIME_NOW_MS: t, PLAN: plan, WORKER_JOB: job, QUARANTINED_ARTIFACTS: [a], VERIFICATION: v });

    assert.deepEqual(await readAcceptedArtifactContentV1(dir, out.acceptance, a.ARTIFACT_ID), b);
    await assert.rejects(readAcceptedArtifactContentV1(dir, out.acceptance, "other"), /ARTIFACT_NOT_ACCEPTED/);
    await assert.rejects(readAcceptedArtifactContentV1(dir, out.acceptance, a.ARTIFACT_ID.replace("artifact", "other")), /ARTIFACT_NOT_ACCEPTED/);
    const immutablePath = (await sealStagedArtifactContentV1(dir, a)).path;
    await chmod(immutablePath, 0o600);
    await writeFile(immutablePath, "corrupted immutable");
    await assert.rejects(readAcceptedArtifactContentV1(dir, out.acceptance, a.ARTIFACT_ID), /ARTIFACT_CONTENT_MISMATCH/);
    await writeFile(immutablePath, b);
    assert.equal((await sealStagedArtifactContentV1(dir, a)).replay, true);
    await assert.rejects(readAcceptedArtifactContentV1(dir, { ...out.acceptance, ACCEPTANCE_RECORD_SHA256: "0".repeat(64) }, a.ARTIFACT_ID), /ARTIFACT_ACCEPTANCE_INVALID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
