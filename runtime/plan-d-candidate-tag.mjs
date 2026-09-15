import { createHash } from "node:crypto";

export const RUNTIME_D_CANDIDATE_TAG_ENVELOPE_TYPE = "RUNTIME_D_CANDIDATE_TAG_ENVELOPE_V1";

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TAG_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function buildRuntimeDCandidateTagEnvelope({
  task_contract_hash,
  approval_evidence_sha256,
  merge_envelope_sha256,
  repository,
  tag_name,
  target_commit_sha,
  candidate_ref,
  candidate_readback
}) {
  const errors = [];
  if (!SHA256_RE.test(task_contract_hash ?? "")) errors.push("TASK_CONTRACT_HASH_INVALID");
  if (!SHA256_RE.test(approval_evidence_sha256 ?? "")) errors.push("APPROVAL_EVIDENCE_SHA256_INVALID");
  if (!SHA256_RE.test(merge_envelope_sha256 ?? "")) errors.push("MERGE_ENVELOPE_SHA256_INVALID");
  if (!REPOSITORY_RE.test(repository ?? "")) errors.push("REPOSITORY_INVALID");
  if (!TAG_RE.test(tag_name ?? "")) errors.push("TAG_NAME_INVALID");
  if (!TAG_RE.test(candidate_ref ?? "")) errors.push("CANDIDATE_REF_INVALID");
  if (!SHA40_RE.test(target_commit_sha ?? "")) errors.push("TARGET_COMMIT_SHA_INVALID");

  const readbackKeys = ["repository", "candidate_ref", "observed_head_sha"];
  if (!exactKeys(candidate_readback, readbackKeys)) {
    errors.push("CANDIDATE_READBACK_FIELDS_MISMATCH");
  } else {
    if (candidate_readback.repository !== repository) errors.push("READBACK_REPOSITORY_MISMATCH");
    if (candidate_readback.candidate_ref !== candidate_ref) errors.push("READBACK_CANDIDATE_REF_MISMATCH");
    if (candidate_readback.observed_head_sha !== target_commit_sha) errors.push("READBACK_TARGET_COMMIT_MISMATCH");
  }

  if (errors.length > 0) return { ok: false, result: "BLOCKED", errors, envelope: null };

  const payload = {
    envelope_type: RUNTIME_D_CANDIDATE_TAG_ENVELOPE_TYPE,
    task_contract_hash,
    approval_evidence_sha256,
    merge_envelope_sha256,
    repository,
    tag_name,
    target_commit_sha,
    candidate_ref,
    candidate_readback_sha256: sha256Json(candidate_readback),
    exact_target_bound: true,
    provider_tag_mutation_authority: "NONE_IN_D2_MECHANICS_TEST",
    candidate_tag_does_not_imply_deploy: true,
    production_deploy_authority: "NONE",
    production_release_authority: "NONE",
    final_merge_authority: "HUMAN_ONLY",
    result: "COORDINATED_DEFERRED"
  };
  return {
    ok: true,
    result: "COORDINATED_DEFERRED",
    errors: [],
    envelope: { ...payload, envelope_sha256: sha256Json(payload) }
  };
}

export function verifyRuntimeDCandidateTagEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { ok: false, errors: ["TAG_ENVELOPE_MISSING"] };
  const { envelope_sha256, ...payload } = envelope;
  if (!SHA256_RE.test(envelope_sha256 ?? "")) errors.push("TAG_ENVELOPE_SHA256_INVALID");
  else if (sha256Json(payload) !== envelope_sha256) errors.push("TAG_ENVELOPE_SHA256_MISMATCH");
  if (envelope.envelope_type !== RUNTIME_D_CANDIDATE_TAG_ENVELOPE_TYPE) errors.push("TAG_ENVELOPE_TYPE_MISMATCH");
  if (envelope.exact_target_bound !== true) errors.push("EXACT_TARGET_BINDING_REQUIRED");
  if (envelope.provider_tag_mutation_authority !== "NONE_IN_D2_MECHANICS_TEST") errors.push("TAG_MUTATION_AUTHORITY_FORBIDDEN");
  if (envelope.candidate_tag_does_not_imply_deploy !== true) errors.push("TAG_DEPLOY_IMPLICATION_FORBIDDEN");
  if (envelope.production_deploy_authority !== "NONE") errors.push("PRODUCTION_DEPLOY_AUTHORITY_FORBIDDEN");
  if (envelope.production_release_authority !== "NONE") errors.push("PRODUCTION_RELEASE_AUTHORITY_FORBIDDEN");
  if (envelope.final_merge_authority !== "HUMAN_ONLY") errors.push("FINAL_MERGE_MUST_BE_HUMAN_ONLY");
  if (envelope.result !== "COORDINATED_DEFERRED") errors.push("TAG_RESULT_MUST_REMAIN_DEFERRED");
  return { ok: errors.length === 0, errors };
}

export function evaluateRuntimeDCandidateTagActivation(envelope) {
  const checked = verifyRuntimeDCandidateTagEnvelope(envelope);
  if (!checked.ok) return { ok: false, result: "BLOCKED", errors: checked.errors, provider_mutation_allowed: false };
  return {
    ok: true,
    result: "DEFERRED",
    errors: [],
    provider_mutation_allowed: false,
    deploy_implied: false,
    production_authority: "NONE"
  };
}
