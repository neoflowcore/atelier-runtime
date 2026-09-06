import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function collectNullPaths(value, pointer = "$", output = []) {
  if (value === null) {
    output.push(pointer);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNullPaths(entry, `${pointer}[${index}]`, output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectNullPaths(entry, `${pointer}.${key}`, output);
    }
  }
  return output;
}

function collectOperations(parsed) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(parsed.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod)) continue;
      operations.push({
        path,
        method: normalizedMethod,
        operationId: typeof operation?.operationId === "string" ? operation.operationId : null
      });
    }
  }
  return operations.sort((a, b) => `${a.path}\u0000${a.method}`.localeCompare(`${b.path}\u0000${b.method}`));
}

function isExactAllowedDispatch(operation, policy) {
  const allowed = policy.allowed_dispatch;
  return operation.method === allowed.method
    && operation.path === allowed.path
    && operation.operationId === allowed.operation_id;
}

function forbiddenReason(operation, policy) {
  const { path, method, operationId = "" } = operation;

  if (path.includes("/actions/workflows/") && path.endsWith("/dispatches") && method === "post") {
    if (!isExactAllowedDispatch(operation, policy)) return "ARBITRARY_WORKFLOW_DISPATCH";
  }
  if (/\/actions\/runs\/[^/]+\/(rerun|rerun-failed-jobs|cancel)$/.test(path) && method !== "get") {
    return "WORKFLOW_RUN_MUTATION";
  }
  if ((/\/pulls\/[^/]+\/merge$/.test(path) || /\/merges$/.test(path)) && method !== "get") {
    return "MERGE_SURFACE";
  }
  if (/\/pulls\/[^/]+\/ready_for_review$/.test(path) && method !== "get") {
    return "READY_FOR_REVIEW_SURFACE";
  }
  if (/\/git\/refs(?:\/|$)/.test(path) && method === "delete") return "REF_DELETE_SURFACE";
  if (/\/contents(?:\/|$)/.test(path) && method !== "get") return "HIGH_LEVEL_CONTENT_WRITE";
  if (/\b(auto.?merge|rerun|ready.?for.?review|delete.*ref|cancel.*workflow)\b/i.test(operationId)) {
    return "FORBIDDEN_OPERATION_ID";
  }
  return null;
}

function normalizePolicy(policy) {
  const baseline = sortedUnique(policy?.baseline_operation_ids ?? []);
  const expectedAdded = sortedUnique(policy?.expected_added_operation_ids ?? []);
  const allowed = policy?.allowed_dispatch ?? {};
  const errors = [];

  if (policy?.policy_version !== 1) errors.push("POLICY_VERSION_NOT_1");
  if (!baseline.length) errors.push("BASELINE_OPERATION_IDS_EMPTY");
  if (!expectedAdded.length) errors.push("EXPECTED_ADDED_OPERATION_IDS_EMPTY");
  if (!Number.isInteger(policy?.expected_total)) errors.push("EXPECTED_TOTAL_INVALID");
  if (!/^[0-9a-f]{64}$/.test(policy?.expected_schema_sha256 ?? "")) errors.push("EXPECTED_SCHEMA_SHA256_INVALID");
  if (!HTTP_METHODS.has(allowed.method)) errors.push("ALLOWED_DISPATCH_METHOD_INVALID");
  if (typeof allowed.path !== "string" || !allowed.path) errors.push("ALLOWED_DISPATCH_PATH_INVALID");
  if (typeof allowed.operation_id !== "string" || !allowed.operation_id) errors.push("ALLOWED_DISPATCH_OPERATION_ID_INVALID");
  if (baseline.some((id) => expectedAdded.includes(id))) errors.push("BASELINE_AND_ADDED_OVERLAP");

  return {
    errors,
    policy: {
      policy_version: 1,
      baseline_operation_ids: baseline,
      expected_added_operation_ids: expectedAdded,
      expected_total: policy?.expected_total,
      expected_schema_sha256: policy?.expected_schema_sha256,
      allowed_dispatch: {
        method: allowed.method,
        path: allowed.path,
        operation_id: allowed.operation_id
      }
    }
  };
}

export function validateBuilderSchema(schemaText, rawPolicy) {
  const normalized = normalizePolicy(rawPolicy);
  const errors = [...normalized.errors];
  const policy = normalized.policy;
  const schemaSha256 = sha256(schemaText);
  const document = parseDocument(schemaText, { prettyErrors: false, strict: true, uniqueKeys: true });

  for (const error of document.errors) errors.push(`YAML_PARSE:${error.code ?? "ERROR"}:${error.message}`);

  let parsed = null;
  if (document.errors.length === 0) {
    try {
      parsed = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
      errors.push(`YAML_TO_JS:${error.message}`);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("OPENAPI_DOCUMENT_NOT_OBJECT");
    parsed = {};
  }
  if (parsed.openapi !== "3.1.0") errors.push(`OPENAPI_VERSION_INVALID:${parsed.openapi ?? "MISSING"}`);
  if (!parsed.info || typeof parsed.info !== "object") errors.push("OPENAPI_INFO_MISSING");
  if (!Array.isArray(parsed.servers) || !parsed.servers.some((entry) => entry?.url === "https://api.github.com")) {
    errors.push("GITHUB_API_SERVER_MISSING");
  }
  if (!parsed.paths || typeof parsed.paths !== "object" || Array.isArray(parsed.paths)) errors.push("OPENAPI_PATHS_MISSING");
  if (schemaSha256 !== policy.expected_schema_sha256) errors.push(`SCHEMA_SHA256_MISMATCH:${schemaSha256}`);

  const nullValuePaths = collectNullPaths(parsed).sort();
  if (nullValuePaths.length) errors.push(`NULL_VALUES_PRESENT:${nullValuePaths.join(",")}`);

  const operations = collectOperations(parsed);
  const operationIds = operations.map((entry) => entry.operationId).filter(Boolean);
  const missingOperationIds = operations.filter((entry) => !entry.operationId).map((entry) => `${entry.method.toUpperCase()} ${entry.path}`);
  if (missingOperationIds.length) errors.push(`OPERATION_ID_MISSING:${missingOperationIds.join(",")}`);

  const uniqueOperationIds = sortedUnique(operationIds);
  if (operationIds.length !== uniqueOperationIds.length) {
    const counts = new Map();
    for (const id of operationIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
    errors.push(`OPERATION_ID_DUPLICATE:${duplicates.join(",")}`);
  }

  const actualSet = new Set(uniqueOperationIds);
  const baselineMissing = policy.baseline_operation_ids.filter((id) => !actualSet.has(id));
  const actualAdded = uniqueOperationIds.filter((id) => !policy.baseline_operation_ids.includes(id));
  const unexpectedAdded = actualAdded.filter((id) => !policy.expected_added_operation_ids.includes(id));
  const expectedAddedMissing = policy.expected_added_operation_ids.filter((id) => !actualSet.has(id));

  if (baselineMissing.length) errors.push(`BASELINE_OPERATION_MISSING:${baselineMissing.join(",")}`);
  if (unexpectedAdded.length) errors.push(`UNEXPECTED_OPERATION_ADDED:${unexpectedAdded.join(",")}`);
  if (expectedAddedMissing.length) errors.push(`EXPECTED_OPERATION_MISSING:${expectedAddedMissing.join(",")}`);
  if (operations.length !== policy.expected_total) errors.push(`OPERATION_TOTAL_MISMATCH:${operations.length}`);
  if (uniqueOperationIds.length !== policy.expected_total) errors.push(`UNIQUE_OPERATION_TOTAL_MISMATCH:${uniqueOperationIds.length}`);

  const forbiddenHits = operations
    .map((operation) => ({ operation, reason: forbiddenReason(operation, policy) }))
    .filter((entry) => entry.reason)
    .map(({ operation, reason }) => ({
      reason,
      method: operation.method,
      path: operation.path,
      operation_id: operation.operationId
    }));
  if (forbiddenHits.length) errors.push(`FORBIDDEN_SURFACE:${forbiddenHits.map((hit) => `${hit.reason}:${hit.method}:${hit.path}`).join("|")}`);

  const allowedDispatches = operations.filter((operation) => isExactAllowedDispatch(operation, policy));
  if (allowedDispatches.length !== 1) errors.push(`APPROVED_DISPATCH_COUNT:${allowedDispatches.length}`);

  const manifest = {
    manifest_version: 1,
    bridge: "pilote-builder-bridge",
    input: {
      schema_sha256: schemaSha256,
      size_bytes: Buffer.byteLength(schemaText, "utf8")
    },
    openapi: parsed.openapi ?? null,
    operations: {
      total: operations.length,
      unique: uniqueOperationIds.length,
      ids: uniqueOperationIds
    },
    baseline: {
      expected_total: policy.expected_total,
      preserved_count: policy.baseline_operation_ids.length - baselineMissing.length,
      missing: baselineMissing,
      expected_added: policy.expected_added_operation_ids,
      actual_added: actualAdded,
      unexpected_added: unexpectedAdded,
      expected_added_missing: expectedAddedMissing
    },
    dispatch: {
      allowed: policy.allowed_dispatch,
      exact_allowed_count: allowedDispatches.length,
      forbidden_hits: forbiddenHits
    },
    null_value_paths: nullValuePaths,
    result: errors.length === 0 ? "PASS" : "FAIL",
    errors
  };

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const receipt = {
    receipt_version: 1,
    bridge: "pilote-builder-bridge",
    schema_sha256: schemaSha256,
    manifest_sha256: sha256(manifestText),
    operation_total: operations.length,
    operation_unique: uniqueOperationIds.length,
    baseline_preserved: baselineMissing.length === 0,
    exact_expected_additions: unexpectedAdded.length === 0 && expectedAddedMissing.length === 0,
    forbidden_surface_zero: forbiddenHits.length === 0,
    null_value_zero: nullValuePaths.length === 0,
    result: manifest.result
  };

  return {
    ok: errors.length === 0,
    manifest,
    manifestText,
    receipt,
    receiptText: `${JSON.stringify(receipt, null, 2)}\n`
  };
}

export function buildApplyBundle(schemaText, policy) {
  const validation = validateBuilderSchema(schemaText, policy);
  if (!validation.ok) {
    const error = new Error(`BUILDER_BRIDGE_VALIDATION_FAILED\n${validation.manifest.errors.join("\n")}`);
    error.validation = validation;
    throw error;
  }

  const files = {
    "PILOTE_BUILDER_ACTIONS.yaml": schemaText,
    "builder-manifest.json": validation.manifestText,
    "pre-apply-receipt.json": validation.receiptText
  };
  const checksumLines = Object.keys(files)
    .sort()
    .map((name) => `${sha256(files[name])}  ${name}`);
  files["SHA256SUMS.txt"] = `${checksumLines.join("\n")}\n`;

  return { validation, files };
}

export async function writeApplyBundle({ schemaText, policy, outputDir }) {
  const bundle = buildApplyBundle(schemaText, policy);
  await mkdir(outputDir, { recursive: true });
  for (const [name, content] of Object.entries(bundle.files)) {
    await writeFile(join(outputDir, name), content, "utf8");
  }
  return bundle;
}

export { sha256 };
