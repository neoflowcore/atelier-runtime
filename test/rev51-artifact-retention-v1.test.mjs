import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateArtifactRetentionV1 as evaluate } from "../runtime/rev51/artifact-retention-v1.mjs";
const a = { RETENTION_CLASS: "UNTIL_FINAL_ACCEPTANCE", ARTIFACT_STATE: "IMMUTABLE", SECURITY_DOMAIN: "project-a" };
const c = { RUNTIME_NOW_MS: 100, SECURITY_DOMAIN: "project-a", REFERENCED_BY_ACTIVE_EXECUTION: false, SHARED_CONTENT_REFERENCE_COUNT: 0, AUTHORITATIVE_GC_TOMBSTONE: true, RECEIPT_RETAINED: false, CHECKPOINT_ANCESTRY_REFERENCE: false, EXPLICIT_PIN: false, ROLLBACK_ACTIVE: false, FINAL_ACCEPTANCE_TERMINAL: true };
test("retention blocks missing evidence, active references, and other domains", () => {
  for (const override of [{ AUTHORITATIVE_GC_TOMBSTONE: false }, { REFERENCED_BY_ACTIVE_EXECUTION: true }, { SHARED_CONTENT_REFERENCE_COUNT: 1 }, { SECURITY_DOMAIN: "other" }, { FINAL_ACCEPTANCE_TERMINAL: false }, { RECEIPT_RETAINED: true }, { CHECKPOINT_ANCESTRY_REFERENCE: true }, { EXPLICIT_PIN: true }, { ROLLBACK_ACTIVE: true }]) assert.equal(evaluate(a, { ...c, ...override }).eligible, false);
  assert.equal(evaluate(a, c).eligible, true);
});
test("pinned and audit artifacts never become eligible; timing requires authoritative expiry", () => {
  for (const RETENTION_CLASS of ["PINNED", "AUDIT_LONG_TERM"]) assert.equal(evaluate({ ...a, RETENTION_CLASS }, c).eligible, false);
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "UNTIL_ROLLBACK_WINDOW_END" }, { ...c, ROLLBACK_WINDOW_END_MS: 101 }).eligible, false);
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "UNTIL_ROLLBACK_WINDOW_END" }, { ...c, ROLLBACK_WINDOW_END_MS: 100 }).eligible, true);
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "TEMPORARY" }, { ...c, TEMPORARY_EXPIRES_AT_MS: 100 }).eligible, true);
});
test("cache and checkpoint retention fail closed on unknown references", () => {
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "CACHE_EVICTABLE" }, c).eligible, false);
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "CACHE_EVICTABLE" }, { ...c, CACHE_LEASES_RELEASED: true }).eligible, true);
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "CHECKPOINT_LATEST_N" }, { ...c, CHECKPOINT_OUTSIDE_LATEST_N: true }).eligible, false);
  assert.equal(evaluate({ ...a, RETENTION_CLASS: "CHECKPOINT_LATEST_N" }, { ...c, CHECKPOINT_OUTSIDE_LATEST_N: true, RESUME_REFERENCE_RELEASED: true }).eligible, true);
});
