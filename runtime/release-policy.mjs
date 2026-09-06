const EXPECTED_INPUTS = Object.freeze([
  "idempotency_key",
  "profile",
  "profile_version",
  "request_id",
  "runtime_sha",
  "target_sha"
]);

const REQUIRED_PATHS = Object.freeze([
  ".github/workflows/node-web-verify.yml",
  "docs/SECURITY_BOUNDARY.md",
  "docs/TARGET_REPO_INTEGRATION.md",
  "docs/V1_SCOPE_LOCK.md",
  "schemas/runtime-contract.schema.json",
  "schemas/runtime-receipt.schema.json",
  "scripts/security-lint.mjs",
  "test/runtime.test.mjs",
  "test/receipt.test.mjs",
  "test/browser-runtime.test.mjs"
]);

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function workflowInputs(text) {
  const start = text.indexOf("    inputs:\n");
  const end = text.indexOf("\npermissions:", start);
  if (start < 0 || end < 0) return [];
  return [...text.slice(start, end).matchAll(/^      ([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]).sort();
}

function exactArray(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function actionUse(line) {
  const match = line.match(/^\s*-\s*uses:\s*([^\s]+)(?:\s*#.*)?$/);
  return match?.[1] ?? null;
}

export function evaluateReleasePolicy({
  workflowText,
  versionText,
  packageJson,
  lockJson,
  securityBoundaryText,
  scopeLockText,
  availablePaths
}) {
  const errors = [];
  const version = versionText.trim();

  if (version !== "1.0.0") errors.push("VERSION_NOT_V1_0_0");
  if (packageJson?.version !== version) errors.push("PACKAGE_VERSION_MISMATCH");
  if (lockJson?.version !== version || lockJson?.packages?.[""]?.version !== version) errors.push("LOCK_VERSION_MISMATCH");
  if (packageJson?.engines?.node !== "22.13.0") errors.push("NODE_VERSION_NOT_FIXED");

  const inputs = workflowInputs(workflowText);
  if (!exactArray(inputs, EXPECTED_INPUTS)) errors.push(`REQUEST_INPUT_SURFACE:${inputs.join(",")}`);

  const uses = workflowText.split("\n").map(actionUse).filter(Boolean);
  if (uses.length === 0) errors.push("NO_ACTION_DEPENDENCIES");
  for (const use of uses) {
    if (!/^[^\s@]+@[0-9a-f]{40}$/.test(use)) errors.push(`FLOATING_ACTION:${use}`);
  }

  const runtimeCheckout = [
    "repository: neoflowcore/atelier-runtime",
    "ref: ${{ inputs.runtime_sha }}",
    "path: runtime"
  ].every((value) => workflowText.includes(value));
  const targetCheckout = [
    "repository: ${{ github.repository }}",
    "ref: ${{ inputs.target_sha }}",
    "path: target"
  ].every((value) => workflowText.includes(value));
  if (!runtimeCheckout || !targetCheckout) errors.push("DUAL_CHECKOUT_NOT_FIXED");
  if (count(workflowText, /^\s*persist-credentials:\s*false\s*$/gm) < 2) errors.push("CHECKOUT_CREDENTIAL_PERSISTENCE_NOT_DISABLED");

  if (!/^permissions:\n\s+contents:\s+read\s*$/m.test(workflowText)) errors.push("CONTENTS_READ_PERMISSION_MISSING");
  if (!workflowText.includes("group: atelier-runtime-${{ github.repository_id }}-${{ inputs.idempotency_key }}")) errors.push("CONCURRENCY_GROUP_INVALID");
  if (!workflowText.includes("cancel-in-progress: false")) errors.push("CONCURRENCY_CANCEL_INVALID");
  if (!workflowText.includes("node-version: 22.13.0")) errors.push("WORKFLOW_NODE_VERSION_NOT_FIXED");
  if (!workflowText.includes("timeout-minutes: 15")) errors.push("JOB_TIMEOUT_NOT_FIXED");

  for (const marker of [
    "run-receipt-init.mjs",
    "run-preflight.mjs",
    "run-stages.mjs",
    "run-web.mjs",
    "run-browser.mjs",
    "run-receipt-finalize.mjs",
    "run-receipt-gate.mjs"
  ]) {
    if (!workflowText.includes(marker)) errors.push(`EXECUTION_PATH_MISSING:${marker}`);
  }

  for (const policy of [
    "SOURCE_WRITE=DENY",
    "REMOTE_SOURCE_WRITE_AUTHORITY=NONE",
    "RAW_SHELL_INPUT=DENY",
    "ARBITRARY_COMMAND_INPUT=DENY",
    "ARBITRARY_ARGS_INPUT=DENY",
    "ARBITRARY_ENV_INPUT=DENY",
    "CHECKOUT_PERSIST_CREDENTIALS=FALSE",
    "AUTO_RETRY=0",
    "ACTION_DEPENDENCY_PINNING=FULL_COMMIT_SHA"
  ]) {
    if (!securityBoundaryText.includes(policy)) errors.push(`SECURITY_POLICY_MISSING:${policy}`);
  }
  if (!scopeLockText.includes("AUTO_RETRY=0")) errors.push("SCOPE_AUTO_RETRY_NOT_ZERO");
  if (!scopeLockText.includes("SOURCE_REF=EXACT_SHA")) errors.push("SCOPE_EXACT_SHA_MISSING");

  const pathSet = new Set(availablePaths);
  for (const path of REQUIRED_PATHS) if (!pathSet.has(path)) errors.push(`RELEASE_ARTIFACT_MISSING:${path}`);

  return {
    ok: errors.length === 0,
    errors,
    gates: {
      runtime_version_binding: errors.every((error) => !/VERSION|PACKAGE_VERSION|LOCK_VERSION/.test(error)),
      exact_sha: errors.every((error) => !/EXACT_SHA|DUAL_CHECKOUT/.test(error)),
      dual_checkout: !errors.includes("DUAL_CHECKOUT_NOT_FIXED"),
      action_sha_pinning: errors.every((error) => !error.startsWith("FLOATING_ACTION")),
      source_write_zero: errors.every((error) => !/SOURCE_WRITE|CREDENTIAL_PERSISTENCE/.test(error)),
      raw_shell_input_zero: errors.every((error) => !/REQUEST_INPUT_SURFACE|RAW_SHELL|ARBITRARY_(COMMAND|ARGS|ENV)/.test(error)),
      auto_retry_zero: errors.every((error) => !/AUTO_RETRY/.test(error))
    }
  };
}

export { EXPECTED_INPUTS, REQUIRED_PATHS };
