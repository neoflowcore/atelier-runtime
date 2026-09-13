import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildPlanAFoundationReceipt, validatePlanAFoundationReceipt } from "./plan-a-foundation.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

async function sourceState(cwd) {
  return {
    head_sha: await git(cwd, ["rev-parse", "HEAD"]),
    tree_sha: await git(cwd, ["rev-parse", "HEAD^{tree}"]),
    tracked_status: await git(cwd, ["status", "--porcelain", "--untracked-files=no"])
  };
}

async function readTaskContract(targetDirectory) {
  return JSON.parse(await readFile(join(targetDirectory, ".atelier", "task-contract.json"), "utf8"));
}

const targetDirectory = resolve(process.argv[2] ?? "target");
const runtimeDirectory = resolve(process.argv[3] ?? "runtime");
const outputPath = resolve(process.argv[4] ?? "runtime-evidence/runtime-a-foundation-receipt.json");
let taskContract = null;
let before = null;
let after = null;
let runtimeState = null;
let inputFailureReason = null;
let infraFailureReason = null;

try {
  taskContract = await readTaskContract(targetDirectory);
} catch (error) {
  inputFailureReason = `TASK_CONTRACT_INPUT_ERROR:${error.code ?? error.name ?? error.message}`;
}

try {
  before = await sourceState(targetDirectory);
  runtimeState = await sourceState(runtimeDirectory);
  after = await sourceState(targetDirectory);
} catch (error) {
  infraFailureReason = `SOURCE_EVIDENCE_ERROR:${error.code ?? error.name ?? error.message}`;
}

let receipt = buildPlanAFoundationReceipt({
  requestId: process.env.ATELIER_REQUEST_ID ?? "MISSING",
  idempotencyKey: process.env.ATELIER_IDEMPOTENCY_KEY ?? "MISSING",
  repository: process.env.GITHUB_REPOSITORY ?? "invalid/invalid",
  requestedSha: process.env.ATELIER_TARGET_SHA ?? "0".repeat(40),
  executedSha: after?.head_sha ?? null,
  requestedRuntimeSha: process.env.ATELIER_RUNTIME_SHA ?? "0".repeat(40),
  runtimeEngineSha: runtimeState?.head_sha ?? null,
  taskContract,
  observedBackend: {
    runner_environment: process.env.RUNNER_ENVIRONMENT ?? null,
    runner_os: process.env.RUNNER_OS ?? null,
    runner_arch: process.env.RUNNER_ARCH ?? null,
    node_version: process.version
  },
  sourceBefore: before,
  sourceAfter: after
});

if (inputFailureReason) receipt = { ...receipt, result: "BLOCKED", failure_reason: inputFailureReason };
else if (infraFailureReason) receipt = { ...receipt, result: "INFRA_FAILURE", failure_reason: infraFailureReason };

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
const validation = validatePlanAFoundationReceipt(receipt);
console.log(`RUNTIME_A_FOUNDATION_RECEIPT=${validation.ok ? "VALID" : "INVALID"}`);
console.log(`RUNTIME_A_FOUNDATION_RESULT=${receipt.result}`);
console.log(`RUNTIME_A_BACKEND_ID=${receipt.backend_identity.backend_id}`);
console.log(`RUNTIME_A_TASK_CONTRACT_HASH=${receipt.task_contract_hash ?? "NONE"}`);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
