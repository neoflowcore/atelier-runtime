import { createHash } from "node:crypto";

const SHA256_RE = /^[0-9a-f]{40,64}$/;
const CONTENT_SHA256_RE = /^[0-9a-f]{64}$/;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("SOURCE_MUTATION_NON_SAFE_INTEGER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  throw new Error("SOURCE_MUTATION_UNSUPPORTED_CANONICAL_TYPE");
}

function hash(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function addMissing(missing, condition, field) {
  if (condition) missing.add(field);
}

export function compileSourceMutationV1(input = {}) {
  if (input.forcePush === true) throw new Error("FORCE_PUSH_DENIED");
  if (input.blindRetry === true) throw new Error("BLIND_RETRY_DENIED");
  if (input.noopTriggerCommit === true) throw new Error("NOOP_TRIGGER_COMMIT_DENIED");
  const missing = new Set();
  addMissing(missing, typeof input.targetRepository !== "string" || !input.targetRepository, "targetRepository");
  addMissing(missing, typeof input.targetRef !== "string" || !input.targetRef, "targetRef");
  addMissing(missing, !SHA256_RE.test(input.freshHead ?? ""), "freshHead");
  addMissing(missing, !SHA256_RE.test(input.freshTree ?? ""), "freshTree");
  if (!Array.isArray(input.operations) || input.operations.length === 0) missing.add("operations");
  const normalized = [];
  for (const operation of input.operations ?? []) {
    if (!isObject(operation)) throw new Error("MUTATION_OPERATION_INVALID");
    if (!["CREATE", "UPDATE", "DELETE"].includes(operation.kind)) throw new Error("MUTATION_KIND_INVALID");
    if (typeof operation.path !== "string" || !operation.path) missing.add(`operation:${normalized.length}:path`);
    if ((operation.kind === "UPDATE" || operation.kind === "DELETE") && !SHA256_RE.test(operation.currentBlobSha ?? "")) missing.add(`operation:${normalized.length}:currentBlobSha`);
    if ((operation.kind === "CREATE" || operation.kind === "UPDATE") && !CONTENT_SHA256_RE.test(operation.contentSha256 ?? "")) missing.add(`operation:${normalized.length}:contentSha256`);
    normalized.push({
      kind: operation.kind,
      path: operation.path ?? null,
      currentBlobSha: operation.currentBlobSha ?? null,
      contentSha256: operation.contentSha256 ?? null
    });
  }
  if (missing.size > 0) return Object.freeze({ status: "READ_REQUIRED", missingInputs: [...missing].sort(), userApprovalRequired: false, retryAllowedAfterNewInformation: true });
  normalized.sort((a, b) => a.path.localeCompare(b.path));
  const body = {
    SCHEMA_ID: "SOURCE_MUTATION_COMPILER_V1",
    SCHEMA_VERSION: "1",
    targetRepository: input.targetRepository,
    targetRef: input.targetRef,
    freshHead: input.freshHead,
    freshTree: input.freshTree,
    operations: normalized,
    forcePush: false,
    blindRetry: false,
    noopTriggerCommit: false
  };
  return Object.freeze({ status: "COMPILED", request: Object.freeze({ ...body, MUTATION_REQUEST_SHA256: hash(body) }) });
}

export function reconcileMutationReadbackV1({ request, resultHead, resultTree, affectedPaths = [] } = {}) {
  if (!request || request.SCHEMA_ID !== "SOURCE_MUTATION_COMPILER_V1") throw new Error("COMPILED_MUTATION_REQUEST_REQUIRED");
  if (!SHA256_RE.test(resultHead ?? "") || !SHA256_RE.test(resultTree ?? "")) throw new Error("MUTATION_READBACK_HEAD_TREE_REQUIRED");
  const expectedPaths = request.operations.map((operation) => operation.path).sort();
  const actualPaths = [...affectedPaths].sort();
  const samePaths = expectedPaths.length === actualPaths.length && expectedPaths.every((value, index) => value === actualPaths[index]);
  return Object.freeze({ ok: samePaths, code: samePaths ? "MUTATION_READBACK_MATCH" : "MUTATION_READBACK_AFFECTED_PATH_MISMATCH", resultHead, resultTree });
}

export function evaluateSemanticCiV1(input = {}) {
  const requiredAssertions = Array.isArray(input.requiredAssertions) ? input.requiredAssertions : [];
  const failedAssertions = requiredAssertions.filter((assertion) => assertion?.required !== false && assertion?.status !== "PASS").map((assertion) => assertion?.id ?? "UNNAMED_ASSERTION");
  const unexpectedFunctionalFailures = Number.isSafeInteger(input.unexpectedFunctionalFailures) ? input.unexpectedFunctionalFailures : 0;
  const countMismatch = input.countIsContract === true && input.expectedTestCount !== input.observedTestCount;
  const warnings = [];
  if (input.countIsContract !== true && Number.isSafeInteger(input.expectedTestCount) && Number.isSafeInteger(input.observedTestCount) && input.expectedTestCount !== input.observedTestCount) warnings.push("TEST_COUNT_DRIFT_NON_CONTRACTUAL");
  const pass = failedAssertions.length === 0 && unexpectedFunctionalFailures === 0 && !countMismatch;
  return Object.freeze({
    status: pass ? "PASS" : "FAIL",
    failedAssertions,
    unexpectedFunctionalFailures,
    countMismatchIsFailure: countMismatch,
    warnings
  });
}
