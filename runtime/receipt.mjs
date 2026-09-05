export const STAGE_NAMES = Object.freeze([
  "preflight", "install", "format", "lint", "typecheck", "build", "test",
  "integration", "dev_server", "http", "browser", "source_integrity", "receipt_finalize"
]);

export function initialStages() {
  return Object.fromEntries(STAGE_NAMES.map((name) => [name, "NOT_RUN"]));
}

export function createReceipt(identity) {
  return {
    receipt_schema_version: 1,
    request_id: identity.request_id,
    idempotency_key: identity.idempotency_key,
    run_id: String(identity.run_id),
    run_attempt: Number(identity.run_attempt),
    repository: identity.repository,
    requested_sha: identity.requested_sha,
    executed_sha: null,
    profile: "NODE_WEB_VERIFY",
    profile_version: 1,
    runtime_engine_version: identity.runtime_engine_version,
    runtime_engine_sha: identity.runtime_engine_sha,
    environment: {
      runner_image: null, os: null, arch: null, node_version: null, npm_version: null,
      playwright_version: null, chromium_version: null, locale: null, timezone: null
    },
    stages: initialStages(),
    source_integrity: {
      tree_sha_before: null,
      tree_sha_after: null,
      tracked_source_mutation_detected: false,
      remote_source_write_authority: "NONE"
    },
    result: "BLOCKED",
    failure_stage: "PREFLIGHT",
    failure_reason: "RUNTIME_NOT_EXECUTED",
    exit_code: null
  };
}
