import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { validateRoutesDocument } from "./http-check.mjs";

const POLL_INTERVAL_MS = 200;
const CLEANUP_TIMEOUT_MS = 3000;

export function validateWebContract(contract) {
  const errors = [];
  const devScript = contract?.scripts?.dev;
  const routesFile = contract?.http_routes_file;
  const server = contract?.server;

  if (!devScript) {
    if (server) errors.push("SERVER_WITHOUT_DEV_SCRIPT");
    if (routesFile) errors.push("HTTP_ROUTES_WITHOUT_DEV_SCRIPT");
    return { ok: errors.length === 0, errors };
  }

  if (!server || typeof server !== "object" || Array.isArray(server)) {
    errors.push("MISSING_SERVER_CONFIG");
    return { ok: false, errors };
  }
  for (const key of Object.keys(server)) {
    if (!["health_url", "startup_timeout_seconds"].includes(key)) errors.push(`FORBIDDEN_SERVER_FIELD:${key}`);
  }

  try {
    const url = new URL(server.health_url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.hash) {
      errors.push("INVALID_HEALTH_URL");
    }
  } catch {
    errors.push("INVALID_HEALTH_URL");
  }

  if (!Number.isInteger(server.startup_timeout_seconds) || server.startup_timeout_seconds < 1 || server.startup_timeout_seconds > 60) {
    errors.push("INVALID_STARTUP_TIMEOUT");
  }
  if (routesFile !== undefined && routesFile !== ".atelier/routes.json") errors.push("INVALID_HTTP_ROUTES_FILE");
  return { ok: errors.length === 0, errors };
}

function localRouteUrl(healthUrl, path) {
  const base = new URL(healthUrl);
  const url = new URL(path, base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== base.origin) {
    throw new Error("ROUTE_ESCAPES_LOCALHOST");
  }
  return url;
}

async function loadRoutes(targetDirectory, contract) {
  if (!contract.http_routes_file) return [];
  let document;
  try {
    document = JSON.parse(await readFile(resolve(targetDirectory, contract.http_routes_file), "utf8"));
  } catch {
    return { errors: ["INVALID_ROUTES_DOCUMENT"] };
  }
  const validation = validateRoutesDocument(document);
  if (!validation.ok) return { errors: validation.errors };
  return document.routes;
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function processExited(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });
}

async function endpointStopped(url) {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(500) });
    } catch {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function cleanupServer(child, healthUrl) {
  try {
    signalProcessGroup(child, "SIGTERM");
    if (!(await processExited(child, 1500))) {
      signalProcessGroup(child, "SIGKILL");
      await processExited(child, 1000);
    }
    return await endpointStopped(healthUrl);
  } catch {
    return false;
  }
}

async function waitForReadiness(child, healthUrl, timeoutSeconds, getSpawnError) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) return { ok: false, reason: `SPAWN_ERROR:${spawnError.code ?? "UNKNOWN"}` };
    if (child.exitCode !== null || child.signalCode !== null) {
      return { ok: false, reason: `SERVER_EXITED:${child.exitCode ?? child.signalCode}` };
    }
    try {
      const response = await fetch(healthUrl, { redirect: "manual", signal: AbortSignal.timeout(1000) });
      if (response.ok) return { ok: true };
    } catch {
      // Keep polling until the bounded startup deadline.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { ok: false, reason: "STARTUP_TIMEOUT" };
}

async function checkRoutes(healthUrl, routes) {
  for (const [index, route] of routes.entries()) {
    let url;
    try {
      url = localRouteUrl(healthUrl, route.path);
    } catch {
      return { ok: false, reason: `INVALID_ROUTE_URL:${index}` };
    }
    let response;
    try {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    } catch {
      return { ok: false, reason: `ROUTE_FETCH_FAILED:${index}` };
    }
    if (response.status !== route.status) {
      return { ok: false, reason: `STATUS_MISMATCH:${index}:EXPECTED_${route.status}:ACTUAL_${response.status}` };
    }
  }
  return { ok: true };
}

export async function executeWebHttpRuntime(targetDirectory, contract) {
  const validation = validateWebContract(contract);
  if (!validation.ok) {
    return { ok: false, classification: "BLOCKED", failureStage: "PREFLIGHT", errors: validation.errors };
  }
  if (!contract?.scripts?.dev) {
    return { ok: true, devServer: "SKIPPED", http: "SKIPPED", cleanup: "SKIPPED" };
  }

  const routes = await loadRoutes(targetDirectory, contract);
  if (!Array.isArray(routes)) {
    return { ok: false, classification: "BLOCKED", failureStage: "PREFLIGHT", errors: routes.errors };
  }

  let spawnError = null;
  const child = spawn("npm", ["run", contract.scripts.dev], {
    cwd: targetDirectory,
    shell: false,
    detached: true,
    stdio: "inherit"
  });
  child.once("error", (error) => { spawnError = error; });

  let result;
  try {
    const readiness = await waitForReadiness(
      child,
      contract.server.health_url,
      contract.server.startup_timeout_seconds,
      () => spawnError
    );
    if (!readiness.ok) {
      result = { ok: false, classification: "APP_FAILURE", failureStage: "DEV_SERVER", failureReason: readiness.reason };
    } else {
      const http = await checkRoutes(contract.server.health_url, routes);
      result = http.ok
        ? { ok: true, devServer: "PASS", http: routes.length ? "PASS" : "SKIPPED", cleanup: "NOT_RUN" }
        : { ok: false, classification: "APP_FAILURE", failureStage: "HTTP", failureReason: http.reason };
    }
  } finally {
    const cleaned = await cleanupServer(child, contract.server.health_url);
    if (!cleaned) {
      result = { ok: false, classification: "APP_FAILURE", failureStage: "DEV_SERVER", failureReason: "CLEANUP_FAILED" };
    } else if (result?.ok) {
      result.cleanup = "PASS";
    }
  }
  return result;
}
