import { createHash } from "node:crypto";

export const RUNTIME_D_LEASE_TYPE = "RUNTIME_D_LEASE_V1";
export const RUNTIME_D_LEASE_MODES = Object.freeze(["READ_SHARED", "WRITE_EXCLUSIVE"]);
export const RUNTIME_D_LEASE_STATES = Object.freeze(["ACTIVE", "RELEASED", "EXPIRED"]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateId(errors, field, value) {
  if (typeof value !== "string" || !ID_RE.test(value)) errors.push(`${field}:INVALID`);
}

export function deriveRuntimeDLeaseScope({ repository, branch }) {
  if (!REPOSITORY_RE.test(repository ?? "")) throw new Error("REPOSITORY_INVALID");
  if (!BRANCH_RE.test(branch ?? "")) throw new Error("BRANCH_INVALID");
  return sha256Json({ repository, branch });
}

export function validateRuntimeDLeaseRequest(request) {
  const errors = [];
  const keys = [
    "task_contract_hash",
    "approval_id",
    "dispatch_nonce",
    "execution_id",
    "generation",
    "caller_id",
    "repository",
    "branch",
    "workspace_id",
    "mode",
    "now_ms",
    "expires_at_ms"
  ];
  if (!exactKeys(request, keys)) return { ok: false, errors: ["LEASE_REQUEST_FIELDS_MISMATCH"] };
  if (!SHA256_RE.test(request.task_contract_hash ?? "")) errors.push("TASK_CONTRACT_HASH_INVALID");
  for (const field of ["approval_id", "dispatch_nonce", "execution_id", "caller_id", "workspace_id"]) {
    validateId(errors, field.toUpperCase(), request[field]);
  }
  if (!Number.isInteger(request.generation) || request.generation < 1) errors.push("GENERATION_INVALID");
  if (!REPOSITORY_RE.test(request.repository ?? "")) errors.push("REPOSITORY_INVALID");
  if (!BRANCH_RE.test(request.branch ?? "")) errors.push("BRANCH_INVALID");
  if (!RUNTIME_D_LEASE_MODES.includes(request.mode)) errors.push("LEASE_MODE_INVALID");
  if (!Number.isSafeInteger(request.now_ms) || request.now_ms < 0) errors.push("NOW_MS_INVALID");
  if (!Number.isSafeInteger(request.expires_at_ms) || request.expires_at_ms <= request.now_ms) errors.push("EXPIRES_AT_MS_INVALID");
  return { ok: errors.length === 0, errors };
}

function leaseIdentityPayload(request) {
  return {
    task_contract_hash: request.task_contract_hash,
    approval_id: request.approval_id,
    dispatch_nonce: request.dispatch_nonce,
    execution_id: request.execution_id,
    generation: request.generation,
    caller_id: request.caller_id,
    repository: request.repository,
    branch: request.branch,
    workspace_id: request.workspace_id,
    mode: request.mode,
    scope_sha256: deriveRuntimeDLeaseScope(request)
  };
}

export function deriveRuntimeDLeaseId(request) {
  const validation = validateRuntimeDLeaseRequest(request);
  if (!validation.ok) throw new Error(`LEASE_REQUEST_INVALID:${validation.errors.join(",")}`);
  return sha256Json(leaseIdentityPayload(request));
}

export function validateRuntimeDLease(lease) {
  const errors = [];
  const keys = [
    "lease_type",
    "lease_id",
    "task_contract_hash",
    "approval_id",
    "dispatch_nonce",
    "execution_id",
    "generation",
    "caller_id",
    "repository",
    "branch",
    "workspace_id",
    "scope_sha256",
    "mode",
    "state",
    "acquired_at_ms",
    "expires_at_ms",
    "source_write_authority"
  ];
  if (!exactKeys(lease, keys)) return { ok: false, errors: ["LEASE_FIELDS_MISMATCH"] };
  if (lease.lease_type !== RUNTIME_D_LEASE_TYPE) errors.push("LEASE_TYPE_MISMATCH");
  if (!SHA256_RE.test(lease.lease_id ?? "")) errors.push("LEASE_ID_INVALID");
  if (!SHA256_RE.test(lease.task_contract_hash ?? "")) errors.push("TASK_CONTRACT_HASH_INVALID");
  if (!SHA256_RE.test(lease.scope_sha256 ?? "")) errors.push("SCOPE_SHA256_INVALID");
  if (REPOSITORY_RE.test(lease.repository ?? "") && BRANCH_RE.test(lease.branch ?? "")) {
    const expectedScope = deriveRuntimeDLeaseScope(lease);
    if (lease.scope_sha256 !== expectedScope) errors.push("SCOPE_SHA256_MISMATCH");
    const expectedLeaseId = sha256Json(leaseIdentityPayload(lease));
    if (lease.lease_id !== expectedLeaseId) errors.push("LEASE_ID_MISMATCH");
  }
  if (!RUNTIME_D_LEASE_MODES.includes(lease.mode)) errors.push("LEASE_MODE_INVALID");
  if (!RUNTIME_D_LEASE_STATES.includes(lease.state)) errors.push("LEASE_STATE_INVALID");
  if (lease.source_write_authority !== "NONE_BY_LEASE") errors.push("LEASE_MUST_NOT_GRANT_SOURCE_WRITE_AUTHORITY");
  if (!Number.isInteger(lease.generation) || lease.generation < 1) errors.push("GENERATION_INVALID");
  if (!Number.isSafeInteger(lease.acquired_at_ms) || lease.acquired_at_ms < 0) errors.push("ACQUIRED_AT_MS_INVALID");
  if (!Number.isSafeInteger(lease.expires_at_ms) || lease.expires_at_ms <= lease.acquired_at_ms) errors.push("EXPIRES_AT_MS_INVALID");
  return { ok: errors.length === 0, errors };
}

function activeAt(lease, nowMs) {
  return lease?.state === "ACTIVE" && lease.expires_at_ms > nowMs;
}

function conflicts(requestMode, existingMode) {
  if (requestMode === "READ_SHARED") return existingMode === "WRITE_EXCLUSIVE";
  return true;
}

export function evaluateRuntimeDLeaseAcquisition(existingLeases, request) {
  const validation = validateRuntimeDLeaseRequest(request);
  if (!validation.ok) return { ok: false, result: "BLOCKED", errors: validation.errors, lease: null, idempotent_reuse: false };
  if (!Array.isArray(existingLeases)) return { ok: false, result: "BLOCKED", errors: ["LEASE_SET_NOT_ARRAY"], lease: null, idempotent_reuse: false };

  const leaseId = deriveRuntimeDLeaseId(request);
  const exactExisting = existingLeases.find((lease) => lease?.lease_id === leaseId);
  if (exactExisting) {
    const exactValidation = validateRuntimeDLease(exactExisting);
    if (!exactValidation.ok) return { ok: false, result: "BLOCKED", errors: exactValidation.errors, lease: null, idempotent_reuse: false };
    return { ok: true, result: "ACQUIRED", errors: [], lease: exactExisting, idempotent_reuse: true };
  }

  const scopeSha256 = deriveRuntimeDLeaseScope(request);
  const blockers = existingLeases.filter((lease) => {
    const checked = validateRuntimeDLease(lease);
    return checked.ok && lease.scope_sha256 === scopeSha256 && activeAt(lease, request.now_ms) && conflicts(request.mode, lease.mode);
  });
  if (blockers.length > 0) {
    return {
      ok: false,
      result: "BLOCKED",
      errors: ["LEASE_CONFLICT_ACTIVE_SCOPE"],
      lease: null,
      idempotent_reuse: false,
      blocker_lease_ids: blockers.map((lease) => lease.lease_id).sort()
    };
  }

  const lease = {
    lease_type: RUNTIME_D_LEASE_TYPE,
    lease_id: leaseId,
    task_contract_hash: request.task_contract_hash,
    approval_id: request.approval_id,
    dispatch_nonce: request.dispatch_nonce,
    execution_id: request.execution_id,
    generation: request.generation,
    caller_id: request.caller_id,
    repository: request.repository,
    branch: request.branch,
    workspace_id: request.workspace_id,
    scope_sha256: scopeSha256,
    mode: request.mode,
    state: "ACTIVE",
    acquired_at_ms: request.now_ms,
    expires_at_ms: request.expires_at_ms,
    source_write_authority: "NONE_BY_LEASE"
  };
  return { ok: true, result: "ACQUIRED", errors: [], lease, idempotent_reuse: false };
}

export function renewRuntimeDLease(lease, renewal) {
  const current = validateRuntimeDLease(lease);
  if (!current.ok) return { ok: false, result: "BLOCKED", errors: current.errors, lease: null };
  const keys = ["caller_id", "now_ms", "expires_at_ms", "generation"];
  if (!exactKeys(renewal, keys)) return { ok: false, result: "BLOCKED", errors: ["RENEWAL_FIELDS_MISMATCH"], lease: null };
  const errors = [];
  if (lease.state !== "ACTIVE") errors.push("LEASE_NOT_ACTIVE");
  if (lease.expires_at_ms <= renewal.now_ms) errors.push("LEASE_ALREADY_EXPIRED");
  if (renewal.caller_id !== lease.caller_id) errors.push("CALLER_MISMATCH");
  if (renewal.generation !== lease.generation + 1) errors.push("GENERATION_MUST_INCREMENT_BY_ONE");
  if (!Number.isSafeInteger(renewal.now_ms) || renewal.now_ms < lease.acquired_at_ms) errors.push("NOW_MS_INVALID");
  if (!Number.isSafeInteger(renewal.expires_at_ms) || renewal.expires_at_ms <= renewal.now_ms) errors.push("EXPIRES_AT_MS_INVALID");
  if (errors.length > 0) return { ok: false, result: "BLOCKED", errors, lease: null };

  const nextRequest = {
    task_contract_hash: lease.task_contract_hash,
    approval_id: lease.approval_id,
    dispatch_nonce: lease.dispatch_nonce,
    execution_id: lease.execution_id,
    generation: renewal.generation,
    caller_id: lease.caller_id,
    repository: lease.repository,
    branch: lease.branch,
    workspace_id: lease.workspace_id,
    mode: lease.mode,
    now_ms: renewal.now_ms,
    expires_at_ms: renewal.expires_at_ms
  };
  const renewed = {
    ...lease,
    lease_id: deriveRuntimeDLeaseId(nextRequest),
    generation: renewal.generation,
    acquired_at_ms: renewal.now_ms,
    expires_at_ms: renewal.expires_at_ms
  };
  return { ok: true, result: "RENEWED", errors: [], lease: renewed };
}

export function releaseRuntimeDLease(lease, release) {
  const current = validateRuntimeDLease(lease);
  if (!current.ok) return { ok: false, result: "BLOCKED", errors: current.errors, lease: null };
  if (!exactKeys(release, ["caller_id", "now_ms"])) return { ok: false, result: "BLOCKED", errors: ["RELEASE_FIELDS_MISMATCH"], lease: null };
  const errors = [];
  if (release.caller_id !== lease.caller_id) errors.push("CALLER_MISMATCH");
  if (!Number.isSafeInteger(release.now_ms) || release.now_ms < lease.acquired_at_ms) errors.push("NOW_MS_INVALID");
  if (lease.state !== "ACTIVE") errors.push("LEASE_NOT_ACTIVE");
  if (errors.length > 0) return { ok: false, result: "BLOCKED", errors, lease: null };
  return { ok: true, result: "RELEASED", errors: [], lease: { ...lease, state: "RELEASED" } };
}

export function expireRuntimeDLease(lease, nowMs) {
  const current = validateRuntimeDLease(lease);
  if (!current.ok) return { ok: false, result: "BLOCKED", errors: current.errors, lease: null };
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { ok: false, result: "BLOCKED", errors: ["NOW_MS_INVALID"], lease: null };
  if (lease.state !== "ACTIVE" || nowMs < lease.expires_at_ms) return { ok: true, result: "UNCHANGED", errors: [], lease };
  return { ok: true, result: "EXPIRED", errors: [], lease: { ...lease, state: "EXPIRED" } };
}
