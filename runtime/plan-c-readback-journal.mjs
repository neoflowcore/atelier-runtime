import { createHash } from "node:crypto";
import { verifyRuntimeCMutationEnvelope } from "./plan-c-source-write-gateway.mjs";

export const RUNTIME_C_PROVIDER_READBACK_TYPE = "RUNTIME_C_PROVIDER_READBACK_V1";
export const RUNTIME_C_MUTATION_JOURNAL_ENTRY_TYPE = "RUNTIME_C_MUTATION_JOURNAL_ENTRY_V1";

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function evaluateRuntimeCProviderReadback(envelope, observation) {
  const envelopeValidation = verifyRuntimeCMutationEnvelope(envelope);
  const errors = [...envelopeValidation.errors];
  if (!observation) {
    return {
      receipt_type: RUNTIME_C_PROVIDER_READBACK_TYPE,
      envelope_sha256: envelope?.envelope_sha256 ?? null,
      state: "PENDING_PROVIDER_READBACK",
      provider_readback_required: true,
      retry_scheduled_by_runtime: false,
      result: "PENDING",
      reasons: errors
    };
  }

  if (observation.operation !== envelope?.operation) errors.push("READBACK_OPERATION_MISMATCH");
  if (observation.repository !== envelope?.repository) errors.push("READBACK_REPOSITORY_MISMATCH");

  if (envelope?.operation === "CANDIDATE_BRANCH_PUSH") {
    if (observation.candidate_ref !== envelope.target.candidate_ref) errors.push("READBACK_CANDIDATE_REF_MISMATCH");
    if (observation.observed_head_sha !== envelope.target.candidate_commit_sha) errors.push("READBACK_CANDIDATE_HEAD_MISMATCH");
  } else if (envelope?.operation === "DRAFT_PR_CREATE") {
    if (observation.base_ref !== envelope.target.base_ref) errors.push("READBACK_BASE_REF_MISMATCH");
    if (observation.head_ref !== envelope.target.head_ref) errors.push("READBACK_HEAD_REF_MISMATCH");
    if (observation.head_sha !== envelope.target.head_sha) errors.push("READBACK_HEAD_SHA_MISMATCH");
    if (observation.draft !== true) errors.push("READBACK_PR_NOT_DRAFT");
    if (!Number.isInteger(observation.pr_number) || observation.pr_number < 1) errors.push("READBACK_PR_NUMBER_INVALID");
  }

  return {
    receipt_type: RUNTIME_C_PROVIDER_READBACK_TYPE,
    envelope_sha256: envelope?.envelope_sha256 ?? null,
    state: errors.length === 0 ? "READBACK_CONFIRMED" : "READBACK_BLOCKED",
    provider_readback_required: false,
    retry_scheduled_by_runtime: false,
    result: errors.length === 0 ? "PASS" : "BLOCKED",
    reasons: errors
  };
}

export function appendRuntimeCMutationJournal(journal, envelope, readback) {
  if (!Array.isArray(journal)) throw new Error("JOURNAL_NOT_ARRAY");
  const envelopeValidation = verifyRuntimeCMutationEnvelope(envelope);
  if (!envelopeValidation.ok) throw new Error(`ENVELOPE_INVALID:${envelopeValidation.errors.join(",")}`);
  if (!readback || readback.receipt_type !== RUNTIME_C_PROVIDER_READBACK_TYPE) throw new Error("READBACK_INVALID");

  const previous = journal.length > 0 ? journal[journal.length - 1] : null;
  const payload = {
    entry_type: RUNTIME_C_MUTATION_JOURNAL_ENTRY_TYPE,
    sequence: journal.length + 1,
    previous_entry_sha256: previous?.entry_sha256 ?? null,
    operation: envelope.operation,
    envelope_sha256: envelope.envelope_sha256,
    readback_state: readback.state,
    readback_result: readback.result,
    remote_source_write_authority: "GATEWAY_ONLY",
    merge_authority: "NONE",
    lease_state: "NOT_IMPLEMENTED_PLAN_D"
  };
  const entry = { ...payload, entry_sha256: sha256Json(payload) };
  return [...journal, entry];
}

export function validateRuntimeCMutationJournal(journal) {
  const errors = [];
  if (!Array.isArray(journal)) return { ok: false, errors: ["JOURNAL_NOT_ARRAY"] };
  let previousSha = null;
  for (let index = 0; index < journal.length; index += 1) {
    const entry = journal[index];
    if (entry.entry_type !== RUNTIME_C_MUTATION_JOURNAL_ENTRY_TYPE) errors.push(`ENTRY_${index + 1}:TYPE_MISMATCH`);
    if (entry.sequence !== index + 1) errors.push(`ENTRY_${index + 1}:SEQUENCE_MISMATCH`);
    if (entry.previous_entry_sha256 !== previousSha) errors.push(`ENTRY_${index + 1}:CHAIN_MISMATCH`);
    if (entry.remote_source_write_authority !== "GATEWAY_ONLY") errors.push(`ENTRY_${index + 1}:AUTHORITY_MISMATCH`);
    if (entry.merge_authority !== "NONE") errors.push(`ENTRY_${index + 1}:MERGE_AUTHORITY_FORBIDDEN`);
    if (entry.lease_state !== "NOT_IMPLEMENTED_PLAN_D") errors.push(`ENTRY_${index + 1}:PLAN_D_LEASE_FENCE_VIOLATION`);
    const { entry_sha256, ...payload } = entry;
    if (sha256Json(payload) !== entry_sha256) errors.push(`ENTRY_${index + 1}:DIGEST_MISMATCH`);
    previousSha = entry_sha256;
  }
  return { ok: errors.length === 0, errors };
}
