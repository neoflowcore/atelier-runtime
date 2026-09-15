import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildPlanAWorkerAttestationReceipt,
  validatePlanAWorkerAttestationReceipt
} from "./worker-attestation-plan-a.mjs";

const execFileAsync = promisify(execFile);

async function runtimeHead(runtimeDirectory) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: runtimeDirectory, encoding: "utf8" });
  return stdout.trim();
}

const runtimeDirectory = resolve(process.argv[2] ?? "runtime");
const outputPath = resolve(process.argv[3] ?? "runtime-evidence/runtime-a-worker-attestation.json");
let runtimeEngineSha = null;
let infraFailureReason = null;

try {
  runtimeEngineSha = await runtimeHead(runtimeDirectory);
} catch (error) {
  infraFailureReason = `RUNTIME_IDENTITY_ERROR:${error.code ?? error.name ?? error.message}`;
}

let receipt = buildPlanAWorkerAttestationReceipt({
  requestId: process.env.ATELIER_REQUEST_ID ?? "MISSING",
  idempotencyKey: process.env.ATELIER_IDEMPOTENCY_KEY ?? "MISSING",
  requestedRuntimeSha: process.env.ATELIER_RUNTIME_SHA ?? "0".repeat(40),
  runtimeEngineSha: runtimeEngineSha ?? "0".repeat(40),
  observedWorker: {
    runner_environment: process.env.RUNNER_ENVIRONMENT ?? null,
    runner_os: process.env.RUNNER_OS ?? null,
    runner_arch: process.env.RUNNER_ARCH ?? null,
    runner_name: process.env.RUNNER_NAME ?? null,
    node_version: process.version
  }
});

if (infraFailureReason) receipt = { ...receipt, result: "INFRA_FAILURE", failure_reason: infraFailureReason };

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
const validation = validatePlanAWorkerAttestationReceipt(receipt);
console.log(`RUNTIME_A_WORKER_ATTESTATION=${validation.ok ? "VALID" : "INVALID"}`);
console.log(`RUNTIME_A_WORKER_RESULT=${receipt.result}`);
console.log(`RUNTIME_A_WORKER_FINGERPRINT=${receipt.worker_fingerprint_sha256}`);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
