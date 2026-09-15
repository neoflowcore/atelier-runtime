import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRuntimeESecurityBoundary,
  validateRuntimeECredentialGrant
} from "../runtime/plan-e-security-boundary.mjs";

function grant(overrides = {}) {
  return {
    grant_type: "RUNTIME_E_CREDENTIAL_GRANT_V1",
    credential_ref: "vault:provider-admin-1",
    credential_material: null,
    purpose: "PROVIDER_ADMIN_WRITE",
    allowed_hosts: ["api.github.com"],
    allowed_operations: ["PUT_RULESET", "PUT_BRANCH_PROTECTION"],
    issued_at_ms: 1000,
    expires_at_ms: 10000,
    authority_evidence_sha256: "a".repeat(64),
    ...overrides
  };
}
const toolchain = { tool: "github-rest", version: "2022-11-28", binary_sha256: "b".repeat(64) };

test("reference-only credential and pinned toolchain are allowed", () => {
  const r = evaluateRuntimeESecurityBoundary({ grant: grant(), requested_host: "api.github.com", requested_operation: "PUT_RULESET", toolchain, now_ms: 5000 });
  assert.equal(r.result, "ALLOWED");
  assert.equal(r.credential_material_present, false);
  assert.equal(r.secret_material_in_receipt, false);
  assert.equal(r.egress_policy, "EXACT_ALLOWLIST_ONLY");
});

test("embedded credential material is rejected", () => {
  const v = validateRuntimeECredentialGrant(grant({ credential_material: "secret" }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("CREDENTIAL_MATERIAL_MUST_NOT_BE_EMBEDDED"));
});

test("wildcard egress is rejected", () => {
  const v = validateRuntimeECredentialGrant(grant({ allowed_hosts: ["*"] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("WILDCARD_OR_INVALID_EGRESS_HOST"));
});

test("non-allowlisted host is blocked", () => {
  const r = evaluateRuntimeESecurityBoundary({ grant: grant(), requested_host: "example.com", requested_operation: "PUT_RULESET", toolchain, now_ms: 5000 });
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.reasons.includes("EGRESS_HOST_NOT_ALLOWLISTED"));
});

test("operation outside credential grant is blocked", () => {
  const r = evaluateRuntimeESecurityBoundary({ grant: grant(), requested_host: "api.github.com", requested_operation: "GET_PRODUCTION_STATE", toolchain, now_ms: 5000 });
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.reasons.includes("OPERATION_NOT_ALLOWED_BY_CREDENTIAL_GRANT"));
});

test("expired credential grant is blocked", () => {
  const r = evaluateRuntimeESecurityBoundary({ grant: grant(), requested_host: "api.github.com", requested_operation: "PUT_RULESET", toolchain, now_ms: 10000 });
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.reasons.includes("CREDENTIAL_GRANT_EXPIRED"));
});

test("unpinned toolchain hash is blocked", () => {
  const r = evaluateRuntimeESecurityBoundary({ grant: grant(), requested_host: "api.github.com", requested_operation: "PUT_RULESET", toolchain: { tool: "github-rest", version: "2022-11-28", binary_sha256: "" }, now_ms: 5000 });
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.reasons.includes("TOOLCHAIN_BINARY_SHA256_INVALID"));
});
