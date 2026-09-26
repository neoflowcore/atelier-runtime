import test from "node:test";
import assert from "node:assert/strict";
import {
  compileSourceMutationV1,
  evaluateSemanticCiV1,
  reconcileMutationReadbackV1
} from "../runtime/rev51/source-mutation-compiler-v1.mjs";

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const BLOB = "c".repeat(40);
const CONTENT = "d".repeat(64);
function base(overrides = {}) {
  return {
    targetRepository: "neoflowcore/atelier-runtime",
    targetRef: "runtime-r51-p8-dependency-lock-cache",
    freshHead: HEAD,
    freshTree: TREE,
    operations: [{ kind: "CREATE", path: "runtime/rev51/example.mjs", contentSha256: CONTENT }],
    ...overrides
  };
}

test("underspecified mutation requests authoritative reads rather than user approval", () => {
  const out = compileSourceMutationV1({ targetRepository: "neoflowcore/atelier-runtime", operations: [] });
  assert.equal(out.status, "READ_REQUIRED");
  assert.equal(out.userApprovalRequired, false);
  assert.equal(out.retryAllowedAfterNewInformation, true);
  assert.ok(out.missingInputs.includes("freshHead"));
  assert.ok(out.missingInputs.includes("freshTree"));
});

test("update and delete require current blob identity", () => {
  const out = compileSourceMutationV1(base({ operations: [{ kind: "UPDATE", path: "a", contentSha256: CONTENT }] }));
  assert.equal(out.status, "READ_REQUIRED");
  assert.ok(out.missingInputs.includes("operation:0:currentBlobSha"));
});

test("fully specified mutation compiles deterministically", () => {
  const a = compileSourceMutationV1(base());
  const b = compileSourceMutationV1(base());
  assert.equal(a.status, "COMPILED");
  assert.equal(a.request.MUTATION_REQUEST_SHA256, b.request.MUTATION_REQUEST_SHA256);
});

test("force push, blind retry and no-op trigger commits are denied", () => {
  assert.throws(() => compileSourceMutationV1(base({ forcePush: true })), /FORCE_PUSH_DENIED/);
  assert.throws(() => compileSourceMutationV1(base({ blindRetry: true })), /BLIND_RETRY_DENIED/);
  assert.throws(() => compileSourceMutationV1(base({ noopTriggerCommit: true })), /NOOP_TRIGGER_COMMIT_DENIED/);
});

test("mutation readback requires exactly the intended affected paths", () => {
  const request = compileSourceMutationV1(base()).request;
  assert.equal(reconcileMutationReadbackV1({ request, resultHead: HEAD, resultTree: TREE, affectedPaths: ["runtime/rev51/example.mjs"] }).ok, true);
  assert.equal(reconcileMutationReadbackV1({ request, resultHead: HEAD, resultTree: TREE, affectedPaths: ["foreign.txt"] }).code, "MUTATION_READBACK_AFFECTED_PATH_MISMATCH");
});

test("semantic CI ignores non-contractual test-count drift", () => {
  const out = evaluateSemanticCiV1({ requiredAssertions: [{ id: "behavior", status: "PASS" }], unexpectedFunctionalFailures: 0, expectedTestCount: 10, observedTestCount: 12, countIsContract: false });
  assert.equal(out.status, "PASS");
  assert.deepEqual(out.warnings, ["TEST_COUNT_DRIFT_NON_CONTRACTUAL"]);
});

test("semantic CI fails contractual count mismatch, failed assertion, or unexpected functional failure", () => {
  assert.equal(evaluateSemanticCiV1({ requiredAssertions: [], expectedTestCount: 10, observedTestCount: 12, countIsContract: true }).status, "FAIL");
  assert.equal(evaluateSemanticCiV1({ requiredAssertions: [{ id: "identity", status: "FAIL" }] }).status, "FAIL");
  assert.equal(evaluateSemanticCiV1({ requiredAssertions: [], unexpectedFunctionalFailures: 1 }).status, "FAIL");
});

test("update request accepts exact current blob and content identities", () => {
  const out = compileSourceMutationV1(base({ operations: [{ kind: "UPDATE", path: "runtime/rev51/example.mjs", currentBlobSha: BLOB, contentSha256: CONTENT }] }));
  assert.equal(out.status, "COMPILED");
  assert.equal(out.request.operations[0].currentBlobSha, BLOB);
});
