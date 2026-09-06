import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureTrackedSourceState, trackedSourceChanged } from "./source-integrity.mjs";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RECEIPT_FIELDS = Object.freeze([
  "receipt_schema_version", "request_id", "idempotency_key", "run_id", "run_attempt",
  "repository", "requested_sha", "executed_sha", "profile", "profile_version",
  "runtime_engine_version", "runtime_engine_sha", "environment", "stages",
  "source_integrity", "result", "failure_stage", "failure_reason", "exit_code"
]);
const ENVIRONMENT_FIELDS = Object.freeze([
  "runner_image", "os", "arch", "node_version", "npm_version", "playwright_version",
  "chromium_version", "locale", "timezone"
]);
const STAGE_FIELDS = Object.freeze([
  "preflight", "install", "format", "lint", "typecheck", "build", "test", "integration",
  "dev_server", "http", "browser", "source_integrity", "receipt_finalize"
]);
const G4_SLOTS = Object.freeze(["format", "lint", "typecheck", "build", "test", "integration"]);
const STAGE_STATES = new Set(["NOT_RUN", "SKIPPED", "PASS", "FAIL", "BLOCKED", "TIMEOUT", "CANCELLED"]);
const RESULT_STATES = new Set(["PASS", "BLOCKED", "APP_FAILURE", "INFRA_FAILURE", "TIMEOUT", "CANCELLED"]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

async function readJsonMaybe(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(cwd, command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd, encoding: "utf8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function captureEnvironmentEvidence(targetDirectory) {
  const playwrightPackage = await readJsonMaybe(join(targetDirectory, "node_modules", "@playwright", "test", "package.json"));
  const browsers = await readJsonMaybe(join(targetDirectory, "node_modules", "playwright-core", "browsers.json"));
  let chromiumVersion = null;
  const chromium = browsers?.browsers?.find((item) => item?.name === "chromium");
  if (chromium?.revision) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright");
    const installPath = join(base, `chromium-${chromium.revision}`);
    if (await pathExists(installPath)) chromiumVersion = chromium.browserVersion ?? null;
  }

  const imageOs = process.env.ImageOS ?? null;
  const imageVersion = process.env.ImageVersion ?? null;
  return {
    runner_image: imageOs && imageVersion ? `${imageOs}@${imageVersion}` : (imageOs ?? process.env.RUNNER_OS ?? null),
    os: process.platform,
    arch: process.arch,
    node_version: process.version,
    npm_version: await commandVersion(targetDirectory, "npm", ["--version"]),
    playwright_version: playwrightPackage?.version ?? null,
    chromium_version: chromiumVersion,
    locale: process.env.LANG ?? null,
    timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  };
}

export async function captureReceiptStart(targetDirectory, runtimeDirectory) {
  const [target, runtime, runtimeVersion] = await Promise.all([
    captureTrackedSourceState(targetDirectory),
    captureTrackedSourceState(runtimeDirectory),
    readFile(join(runtimeDirectory, "VERSION"), "utf8").then((value) => value.trim())
  ]);
  return {
    target,
    runtime_engine_sha: runtime.head_sha,
    runtime_engine_version: runtimeVersion
  };
}

export async function verifyOverlapGuard(runtimeDirectory) {
  const workflow = await readFile(join(runtimeDirectory, ".github", "workflows", "node-web-verify.yml"), "utf8");
  return workflow.includes("group: atelier-runtime-${{ github.repository_id }}-${{ inputs.idempotency_key }}") &&
    workflow.includes("cancel-in-progress: false");
}

function stageDefaults(contract) {
  const scriptsKnown = contract && typeof contract === "object" && contract.scripts && typeof contract.scripts === "object" && !Array.isArray(contract.scripts);
  const stages = {
    preflight: "NOT_RUN",
    install: "NOT_RUN",
    format: "NOT_RUN",
    lint: "NOT_RUN",
    typecheck: "NOT_RUN",
    build: "NOT_RUN",
    test: "NOT_RUN",
    integration: "NOT_RUN",
    dev_server: "NOT_RUN",
    http: "NOT_RUN",
    browser: "NOT_RUN",
    source_integrity: "NOT_RUN",
    receipt_finalize: "PASS"
  };
  if (scriptsKnown) {
    for (const slot of G4_SLOTS) if (!contract.scripts?.[slot]) stages[slot] = "SKIPPED";
    if (!contract.scripts?.dev) {
      stages.dev_server = "SKIPPED";
      stages.http = "SKIPPED";
    } else if (!contract.http_routes_file) {
      stages.http = "SKIPPED";
    }
    if (!contract.scripts?.browser) stages.browser = "SKIPPED";
  }
  return stages;
}

function outcomeState(outcome, failureState = "FAIL") {
  if (outcome === "cancelled") return "CANCELLED";
  if (outcome === "failure") return failureState;
  if (outcome === "success") return "PASS";
  return "NOT_RUN";
}

function failureFromStageEvidence(evidence) {
  if (!evidence || evidence.ok !== false) return null;
  if (evidence.failureStage === "PREFLIGHT" || evidence.classification === "BLOCKED") {
    return {
      result: "BLOCKED",
      failure_stage: "PREFLIGHT",
      failure_reason: evidence.failureReason ?? evidence.errors?.[0] ?? "PREFLIGHT_BLOCKED",
      exit_code: evidence.exitCode ?? 2
    };
  }
  if (evidence.failureStage === "source_integrity") {
    return { result: "APP_FAILURE", failure_stage: "SOURCE_INTEGRITY", failure_reason: "TRACKED_SOURCE_MUTATION", exit_code: evidence.exitCode ?? 3 };
  }
  const stage = String(evidence.failureStage ?? "NODE_RUNTIME").toUpperCase();
  return {
    result: evidence.classification ?? "APP_FAILURE",
    failure_stage: stage,
    failure_reason: evidence.failureReason ?? `${stage}_EXIT_${evidence.exitCode ?? 1}`,
    exit_code: evidence.exitCode ?? 1
  };
}

function firstCancelled(stepOutcomes) {
  for (const [stage, outcome] of Object.entries(stepOutcomes ?? {})) {
    if (outcome === "cancelled") return stage.toUpperCase();
  }
  return null;
}

export function buildReceipt({ identity, contract, start, after, environment, evidence, stepOutcomes, overlapGuard }) {
  const stages = stageDefaults(contract);
  const preflightEvidence = evidence?.preflight;
  if (preflightEvidence) stages.preflight = preflightEvidence.ok ? "PASS" : "BLOCKED";
  else stages.preflight = outcomeState(stepOutcomes?.preflight, "BLOCKED");

  const stagesEvidence = evidence?.stages;
  if (stagesEvidence && stagesEvidence.failureStage !== "PREFLIGHT") {
    stages.install = stagesEvidence.failureStage === "install" ? "FAIL" : "PASS";
    for (const stage of stagesEvidence.stages ?? []) {
      if (G4_SLOTS.includes(stage.slot) && STAGE_STATES.has(stage.state)) stages[stage.slot] = stage.state;
    }
    stages.source_integrity = stagesEvidence.failureStage === "source_integrity" ? "FAIL" : "PASS";
  } else if (!stagesEvidence && stepOutcomes?.stages === "success") {
    stages.install = "PASS";
    for (const slot of G4_SLOTS) if (contract?.scripts?.[slot]) stages[slot] = "PASS";
    stages.source_integrity = "PASS";
  } else if (!stagesEvidence && stepOutcomes?.stages === "failure") {
    stages.install = "FAIL";
  }

  const webEvidence = evidence?.web;
  if (webEvidence?.ok) {
    stages.dev_server = webEvidence.devServer ?? stages.dev_server;
    stages.http = webEvidence.http ?? stages.http;
  } else if (webEvidence?.ok === false) {
    if (webEvidence.failureStage === "PREFLIGHT") {
      stages.dev_server = contract?.scripts?.dev ? "NOT_RUN" : stages.dev_server;
      stages.http = contract?.http_routes_file ? "NOT_RUN" : stages.http;
    } else if (webEvidence.failureStage === "DEV_SERVER") {
      stages.dev_server = "FAIL";
      if (contract?.http_routes_file) stages.http = "NOT_RUN";
    } else if (webEvidence.failureStage === "HTTP") {
      stages.dev_server = "PASS";
      stages.http = "FAIL";
    }
  } else if (!webEvidence && stepOutcomes?.web === "success") {
    if (contract?.scripts?.dev) stages.dev_server = "PASS";
    if (contract?.http_routes_file) stages.http = "PASS";
  }

  const browserEvidence = evidence?.browser;
  if (browserEvidence?.ok) {
    stages.browser = browserEvidence.browserScript ?? stages.browser;
  } else if (browserEvidence?.ok === false) {
    stages.browser = browserEvidence.classification === "BLOCKED" ? "BLOCKED" : browserEvidence.classification === "TIMEOUT" ? "TIMEOUT" : "FAIL";
  } else if (!browserEvidence && stepOutcomes?.browser === "success" && contract?.scripts?.browser) {
    stages.browser = "PASS";
  }

  const sourceChanged = Boolean(start?.target && after && trackedSourceChanged(start.target, after));
  if (start?.target && after) stages.source_integrity = sourceChanged ? "FAIL" : (stages.source_integrity === "FAIL" ? "FAIL" : "PASS");

  let terminal = { result: "PASS", failure_stage: null, failure_reason: null, exit_code: null };
  const cancelledStage = firstCancelled(stepOutcomes);
  if (cancelledStage) {
    terminal = { result: "CANCELLED", failure_stage: cancelledStage, failure_reason: "WORKFLOW_CANCELLED", exit_code: null };
  } else if (identity.requested_sha !== after?.head_sha) {
    terminal = { result: "BLOCKED", failure_stage: "PREFLIGHT", failure_reason: "TARGET_SHA_MISMATCH", exit_code: 2 };
  } else if (start?.runtime_engine_sha && start.runtime_engine_sha !== identity.runtime_engine_sha) {
    terminal = { result: "BLOCKED", failure_stage: "PREFLIGHT", failure_reason: "RUNTIME_SHA_MISMATCH", exit_code: 2 };
  } else {
    const candidates = [preflightEvidence, stagesEvidence, webEvidence, browserEvidence];
    for (const candidate of candidates) {
      const failure = failureFromStageEvidence(candidate);
      if (failure) {
        terminal = failure;
        break;
      }
    }
    if (terminal.result === "PASS") {
      for (const [stage, outcome] of Object.entries(stepOutcomes ?? {})) {
        if (outcome === "failure") {
          terminal = {
            result: "INFRA_FAILURE",
            failure_stage: stage.toUpperCase(),
            failure_reason: `MISSING_${stage.toUpperCase()}_EVIDENCE`,
            exit_code: 1
          };
          break;
        }
      }
    }
  }

  if (terminal.result === "PASS" && !start?.target) {
    terminal = { result: "INFRA_FAILURE", failure_stage: "RECEIPT_FINALIZE", failure_reason: "MISSING_RECEIPT_START_EVIDENCE", exit_code: 1 };
  }
  if (terminal.result === "PASS" && !overlapGuard) {
    terminal = { result: "INFRA_FAILURE", failure_stage: "CONCURRENCY_GUARD", failure_reason: "OVERLAP_GUARD_INVALID", exit_code: 1 };
  }
  if (terminal.result === "PASS" && sourceChanged) {
    terminal = { result: "APP_FAILURE", failure_stage: "SOURCE_INTEGRITY", failure_reason: "TRACKED_SOURCE_MUTATION", exit_code: 3 };
  }

  return {
    receipt_schema_version: 1,
    request_id: identity.request_id,
    idempotency_key: identity.idempotency_key,
    run_id: identity.run_id,
    run_attempt: identity.run_attempt,
    repository: identity.repository,
    requested_sha: identity.requested_sha,
    executed_sha: after?.head_sha ?? null,
    profile: identity.profile,
    profile_version: identity.profile_version,
    runtime_engine_version: start?.runtime_engine_version ?? identity.runtime_engine_version,
    runtime_engine_sha: identity.runtime_engine_sha,
    environment,
    stages,
    source_integrity: {
      tree_sha_before: start?.target?.tree_sha ?? null,
      tree_sha_after: after?.tree_sha ?? null,
      tracked_source_mutation_detected: sourceChanged,
      remote_source_write_authority: "NONE"
    },
    ...terminal
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_FIELDS)) errors.push("INVALID_TOP_LEVEL_FIELDS");
  if (receipt?.receipt_schema_version !== 1) errors.push("INVALID_RECEIPT_SCHEMA_VERSION");
  if (typeof receipt?.request_id !== "string" || receipt.request_id.length < 1 || receipt.request_id.length > 128) errors.push("INVALID_REQUEST_ID");
  if (typeof receipt?.idempotency_key !== "string" || receipt.idempotency_key.length < 1 || receipt.idempotency_key.length > 256) errors.push("INVALID_IDEMPOTENCY_KEY");
  if (typeof receipt?.run_id !== "string" || !/^[0-9]+$/.test(receipt.run_id)) errors.push("INVALID_RUN_ID");
  if (!Number.isInteger(receipt?.run_attempt) || receipt.run_attempt < 1) errors.push("INVALID_RUN_ATTEMPT");
  if (typeof receipt?.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(receipt.repository)) errors.push("INVALID_REPOSITORY");
  if (!SHA_PATTERN.test(receipt?.requested_sha ?? "")) errors.push("INVALID_REQUESTED_SHA");
  if (!(receipt?.executed_sha === null || SHA_PATTERN.test(receipt.executed_sha ?? ""))) errors.push("INVALID_EXECUTED_SHA");
  if (receipt?.profile !== "NODE_WEB_VERIFY") errors.push("INVALID_PROFILE");
  if (receipt?.profile_version !== 1) errors.push("INVALID_PROFILE_VERSION");
  if (typeof receipt?.runtime_engine_version !== "string" || !receipt.runtime_engine_version) errors.push("INVALID_RUNTIME_ENGINE_VERSION");
  if (!SHA_PATTERN.test(receipt?.runtime_engine_sha ?? "")) errors.push("INVALID_RUNTIME_ENGINE_SHA");

  if (!exactKeys(receipt?.environment, ENVIRONMENT_FIELDS)) errors.push("INVALID_ENVIRONMENT_FIELDS");
  else for (const field of ENVIRONMENT_FIELDS) if (!nullableString(receipt.environment[field])) errors.push(`INVALID_ENVIRONMENT_${field.toUpperCase()}`);

  if (!exactKeys(receipt?.stages, STAGE_FIELDS)) errors.push("INVALID_STAGE_FIELDS");
  else for (const field of STAGE_FIELDS) if (!STAGE_STATES.has(receipt.stages[field])) errors.push(`INVALID_STAGE_${field.toUpperCase()}`);

  if (!exactKeys(receipt?.source_integrity, ["tree_sha_before", "tree_sha_after", "tracked_source_mutation_detected", "remote_source_write_authority"])) {
    errors.push("INVALID_SOURCE_INTEGRITY_FIELDS");
  } else {
    for (const field of ["tree_sha_before", "tree_sha_after"]) {
      const value = receipt.source_integrity[field];
      if (!(value === null || SHA_PATTERN.test(value ?? ""))) errors.push(`INVALID_${field.toUpperCase()}`);
    }
    if (typeof receipt.source_integrity.tracked_source_mutation_detected !== "boolean") errors.push("INVALID_MUTATION_FLAG");
    if (receipt.source_integrity.remote_source_write_authority !== "NONE") errors.push("INVALID_REMOTE_SOURCE_WRITE_AUTHORITY");
  }

  if (!RESULT_STATES.has(receipt?.result)) errors.push("INVALID_RESULT");
  if (!(receipt?.failure_stage === null || typeof receipt.failure_stage === "string")) errors.push("INVALID_FAILURE_STAGE");
  if (!(receipt?.failure_reason === null || typeof receipt.failure_reason === "string")) errors.push("INVALID_FAILURE_REASON");
  if (!(receipt?.exit_code === null || Number.isInteger(receipt.exit_code))) errors.push("INVALID_EXIT_CODE");

  if (receipt?.result === "PASS") {
    if (receipt.requested_sha !== receipt.executed_sha) errors.push("PASS_SHA_MISMATCH");
    if (receipt.source_integrity?.tracked_source_mutation_detected) errors.push("PASS_WITH_SOURCE_MUTATION");
    if (receipt.stages?.source_integrity !== "PASS") errors.push("PASS_WITHOUT_SOURCE_INTEGRITY");
    if (receipt.stages?.receipt_finalize !== "PASS") errors.push("PASS_WITHOUT_RECEIPT_FINALIZE");
    if (receipt.failure_stage !== null || receipt.failure_reason !== null || receipt.exit_code !== null) errors.push("PASS_WITH_FAILURE_FIELDS");
  } else if (receipt && receipt.failure_stage === null) {
    errors.push("FAILURE_WITHOUT_STAGE");
  }

  return { ok: errors.length === 0, errors };
}
