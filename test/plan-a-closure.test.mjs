import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAN_A_OWNED_PATHS,
  RUNTIME_DEVELOPMENT_BASE_SHA,
  RUNTIME_DEVELOPMENT_BASE_TREE,
  buildPlanAClosureReceipt,
  validatePlanAClosureReceipt,
  validatePlanARemoteSnapshot,
  verifyPlanAComponentManifest
} from "../runtime/plan-a-closure.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestBytes = await readFile(join(root, "fixtures/runtime-a/plan-a-component-manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");

function validSnapshot(overrides = {}) {
  return {
    repository: "neoflowcore/atelier-runtime",
    main_sha: RUNTIME_DEVELOPMENT_BASE_SHA,
    main_tree: RUNTIME_DEVELOPMENT_BASE_TREE,
    candidate_sha: "1".repeat(40),
    candidate_tree: "2".repeat(40),
    ahead_by: 5,
    behind_by: 0,
    total_commits: 5,
    workflow_runs_count: 0,
    component_tree_binding: "PASS",
    changed_paths: [...PLAN_A_OWNED_PATHS],
    ...overrides
  };
}

test("component manifest binds the complete Plan A-owned source set", async () => {
  const result = await verifyPlanAComponentManifest(root, manifest);
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.equal(manifest.components.length, PLAN_A_OWNED_PATHS.length - 1);
});

test("component manifest rejects a one-byte source mutation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "runtime-a5-"));
  await cp(root, tempRoot, { recursive: true });
  const target = join(tempRoot, "runtime/backend-plan-a.mjs");
  await writeFile(target, `${await readFile(target, "utf8")}\n`, "utf8");
  const result = await verifyPlanAComponentManifest(tempRoot, manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("COMPONENT_SHA256_MISMATCH:runtime/backend-plan-a.mjs"));
});

test("remote snapshot requires exact development base and zero-behind candidate", () => {
  assert.deepEqual(validatePlanARemoteSnapshot(validSnapshot()), { ok: true, errors: [] });
  assert.ok(validatePlanARemoteSnapshot(validSnapshot({ main_sha: "3".repeat(40) })).errors.includes("DEVELOPMENT_BASE_SHA_DRIFT"));
  assert.ok(validatePlanARemoteSnapshot(validSnapshot({ behind_by: 1 })).errors.includes("CANDIDATE_BEHIND_BASE"));
});

test("remote snapshot rejects V1 or foreign path changes", () => {
  const result = validatePlanARemoteSnapshot(validSnapshot({ changed_paths: [...PLAN_A_OWNED_PATHS, "runtime/receipt-core.mjs"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("V1_OR_FOREIGN_PATH_CHANGED:runtime/receipt-core.mjs"));
});

test("remote snapshot requires remote component tree binding", () => {
  const result = validatePlanARemoteSnapshot(validSnapshot({ component_tree_binding: "NOT_VERIFIED" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("REMOTE_COMPONENT_TREE_BINDING_NOT_PASS"));
});

test("remote snapshot preserves Action Economy zero-run closure", () => {
  const result = validatePlanARemoteSnapshot(validSnapshot({ workflow_runs_count: 1 }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("UNEXPECTED_WORKFLOW_RUNS"));
});

test("closure receipt is explicitly static candidate, not a seal or live self-hosted claim", async () => {
  const receipt = await buildPlanAClosureReceipt({ rootDirectory: root, manifest, manifestSha256, remoteSnapshot: validSnapshot() });
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.candidate_class, "COMPATIBLE_FINAL_CANDIDATE_STATIC");
  assert.equal(receipt.remote_component_binding, "PASS");
  assert.match(receipt.remote_snapshot_sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.live_self_hosted_invocation, "NOT_RUN");
  assert.equal(receipt.runtime_a_sealed, "NO");
  assert.equal(receipt.sync2_state, "WAITING_A_REV42_SEALED_MANIFEST");
  assert.equal(receipt.lease_state, "NOT_IMPLEMENTED_PLAN_D");
  assert.equal(receipt.remote_source_write_authority, "NONE");
  assert.deepEqual(validatePlanAClosureReceipt(receipt), { ok: true, errors: [] });
});

test("closure receipt blocks when V1 non-regression evidence fails", async () => {
  const receipt = await buildPlanAClosureReceipt({
    rootDirectory: root,
    manifest,
    remoteSnapshot: validSnapshot({ changed_paths: [...PLAN_A_OWNED_PATHS, "schemas/runtime-receipt.schema.json"] })
  });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.v1_non_regression, "FAIL");
  assert.match(receipt.failure_reason, /^V1_OR_FOREIGN_PATH_CHANGED:/);
});

test("closure receipt validator rejects semantic promotion to sealed or SYNC-2 PASS", async () => {
  const receipt = await buildPlanAClosureReceipt({ rootDirectory: root, manifest, manifestSha256, remoteSnapshot: validSnapshot() });
  assert.equal(validatePlanAClosureReceipt({ ...receipt, runtime_a_sealed: "YES" }).ok, false);
  assert.equal(validatePlanAClosureReceipt({ ...receipt, sync2_state: "PASS" }).ok, false);
});
