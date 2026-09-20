import {
  computeRev51ObjectHash,
  validateContractEnvelope
} from "./contract-core.mjs";

export const WORKER_JOB_CANONICALIZATION_ID = "ATELIER_REV51_JCS_V1";
export const STRUCTURED_ENTRYPOINT_ID = "ENTRYPOINT_SPEC_V1";
export const SEMANTIC_REPLANNING_POLICY = "DENY";
export const SHELL_INTERPRETATION_POLICY = "DENY";

const TRANSPORT_TO_EXECUTION_MODE = Object.freeze({
  DIRECT_WORKER: "DIRECT_REMOTE",
  GITHUB_SELF_HOSTED_JIT: "GITHUB_GATE"
});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, code) {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function requireStringArray(value, code) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(code);
  return [...value];
}

function requireIntegerArray(value, code) {
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item))) throw new Error(code);
  return [...value];
}

export function normalizeStructuredEntrypointV1(spec) {
  if (!isObject(spec)) throw new Error("ENTRYPOINT_SPEC_REQUIRED");

  for (const forbidden of ["shell", "command", "shell_command", "script"]) {
    if (Object.hasOwn(spec, forbidden)) throw new Error(`SHELL_ENTRYPOINT_FIELD_DENY:${forbidden}`);
  }

  const shellPolicy = spec.shell_interpretation ?? SHELL_INTERPRETATION_POLICY;
  if (shellPolicy !== SHELL_INTERPRETATION_POLICY) throw new Error("SHELL_INTERPRETATION_MUST_BE_DENY");

  const timeout = spec.timeout;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("ENTRYPOINT_TIMEOUT_INVALID");

  return {
    schema_id: STRUCTURED_ENTRYPOINT_ID,
    executable: requireNonEmptyString(spec.executable, "ENTRYPOINT_EXECUTABLE_REQUIRED"),
    argv: requireStringArray(spec.argv, "ENTRYPOINT_ARGV_INVALID"),
    working_directory: requireNonEmptyString(spec.working_directory, "ENTRYPOINT_WORKING_DIRECTORY_REQUIRED"),
    environment_refs: requireStringArray(spec.environment_refs, "ENTRYPOINT_ENVIRONMENT_REFS_INVALID"),
    stdin_policy: requireNonEmptyString(spec.stdin_policy, "ENTRYPOINT_STDIN_POLICY_REQUIRED"),
    timeout,
    expected_exit_codes: requireIntegerArray(spec.expected_exit_codes, "ENTRYPOINT_EXPECTED_EXIT_CODES_INVALID"),
    shell_interpretation: SHELL_INTERPRETATION_POLICY
  };
}

export function validateRuntimeExecutionPlanForWorkerJob(plan) {
  if (!isObject(plan)) return { ok: false, errors: ["RUNTIME_EXECUTION_PLAN_REQUIRED"] };

  const envelope = validateContractEnvelope(plan, {
    schemaId: "RUNTIME_EXECUTION_PLAN_V1",
    schemaVersion: "1",
    canonicalizationId: WORKER_JOB_CANONICALIZATION_ID
  });

  const errors = [...envelope.errors];
  if (!TRANSPORT_TO_EXECUTION_MODE[plan.EXECUTION_TRANSPORT]) errors.push("UNSUPPORTED_EXECUTION_TRANSPORT");
  return { ok: errors.length === 0, errors };
}

export function createWorkerJobV1(plan, runtimeAssignment) {
  const planValidation = validateRuntimeExecutionPlanForWorkerJob(plan);
  if (!planValidation.ok) {
    throw new Error(`RUNTIME_EXECUTION_PLAN_REJECTED:${planValidation.errors.join("|")}`);
  }
  if (!isObject(runtimeAssignment)) throw new Error("RUNTIME_ASSIGNMENT_REQUIRED");

  const executionId = requireNonEmptyString(runtimeAssignment.EXECUTION_ID, "EXECUTION_ID_REQUIRED");
  const attemptId = requireNonEmptyString(runtimeAssignment.ATTEMPT_ID, "ATTEMPT_ID_REQUIRED");
  const fenceToken = requireNonEmptyString(runtimeAssignment.FENCE_TOKEN, "FENCE_TOKEN_REQUIRED");
  const entrypointSpec = normalizeStructuredEntrypointV1(runtimeAssignment.ENTRYPOINT_SPEC);
  const executionMode = TRANSPORT_TO_EXECUTION_MODE[plan.EXECUTION_TRANSPORT];

  const job = {
    SCHEMA_ID: "WORKER_JOB_V1",
    SCHEMA_VERSION: "1",
    CANONICALIZATION_ID: WORKER_JOB_CANONICALIZATION_ID,
    UPSTREAM_OBJECT_SHA256: plan.OBJECT_SHA256,
    OBJECT_SHA256: "0".repeat(64),
    EXECUTION_PLAN_HASH: plan.OBJECT_SHA256,
    EXECUTION_ID: executionId,
    ATTEMPT_ID: attemptId,
    FENCE_TOKEN: fenceToken,
    EXECUTION_MODE: executionMode,
    ENTRYPOINT_SPEC: entrypointSpec,
    SEMANTIC_REPLANNING: SEMANTIC_REPLANNING_POLICY
  };

  job.OBJECT_SHA256 = computeRev51ObjectHash(job);

  const envelope = validateContractEnvelope(job, {
    schemaId: "WORKER_JOB_V1",
    schemaVersion: "1",
    canonicalizationId: WORKER_JOB_CANNICALIZATION_ID,
    upstreamObjectSha256: plan.OBJECT_SHA256
  });
  if (!envelope.ok) throw new Error(`WORKER_JOB_ENVELOPE_INVALID:${envelope.errors.join("|")}`);
  if (job.EXECUTION_PLAN_HASH !== plan.OBJECT_SHA256) throw new Error("EXCUTION_PLAN_HASH_BINDING_MISMATCH");

  return job;
}
