import { readFile } from "node:fs/promises";

export const PROFILE = "NODE_WEB_VERIFY";
export const PROFILE_VERSION = 1;
export const NODE_VERSION = "22.13.0";
export const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/;
export const SCRIPT_SLOTS = Object.freeze([
  "format", "lint", "typecheck", "build", "test", "integration", "dev", "browser"
]);

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function validateRuntimeContract(contract, packageJson) {
  const errors = [];
  const allowed = new Set([
    "schema_version", "profile", "node_version", "package_manager", "scripts",
    "server", "http_routes_file"
  ]);
  for (const key of Object.keys(contract ?? {})) {
    if (!allowed.has(key)) errors.push(`FORBIDDEN_FIELD:${key}`);
  }
  if (contract?.schema_version !== 1) errors.push("UNSUPPORTED_SCHEMA_VERSION");
  if (contract?.profile !== PROFILE) errors.push("UNSUPPORTED_PROFILE");
  if (contract?.node_version !== NODE_VERSION) errors.push("UNSUPPORTED_NODE_VERSION");
  if (contract?.package_manager !== "npm") errors.push("UNSUPPORTED_PACKAGE_MANAGER");
  if (!contract?.scripts || typeof contract.scripts !== "object" || Array.isArray(contract.scripts)) {
    errors.push("INVALID_SCRIPTS");
  } else {
    for (const [slot, script] of Object.entries(contract.scripts)) {
      if (!SCRIPT_SLOTS.includes(slot)) errors.push(`UNSUPPORTED_SCRIPT_SLOT:${slot}`);
      if (typeof script !== "string" || !SCRIPT_NAME_PATTERN.test(script)) {
        errors.push(`INVALID_SCRIPT_NAME:${slot}`);
      } else if (!packageJson?.scripts || !(script in packageJson.scripts)) {
        errors.push(`MISSING_PACKAGE_SCRIPT:${script}`);
      }
    }
  }
  if (contract?.http_routes_file !== undefined && contract.http_routes_file !== ".atelier/routes.json") {
    errors.push("INVALID_HTTP_ROUTES_FILE");
  }
  if (contract?.http_routes_file && !contract.server) errors.push("MISSING_SERVER_CONFIG");
  return { ok: errors.length === 0, errors };
}
