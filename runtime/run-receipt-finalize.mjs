import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { captureTrackedSourceState } from "./source-integrity.mjs";
import { buildReceipt, captureEnvironmentEvidence, validateReceipt, verifyOverlapGuard } from "./receipt.mjs";
import { evidenceDirectory, readEvidenceFile, readStageEvidence, writeJsonAtomic } from "./evidence.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");
const runtimeDirectory = resolve(process.argv[3] ?? "runtime");

async function readJsonMaybe(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function captureAfterMaybe() {
  try { return await captureTrackedSourceState(targetDirectory); } catch { return null; }
}

const [start, after, contract, environment, overlapGuard, preflight, stages, web, browser] = await Promise.all([
  readEvidenceFile("start.json"),
  captureAfterMaybe(),
  readJsonMaybe(join(targetDirectory, ".atelier", "runtime.json")),
  captureEnvironmentEvidence(targetDirectory),
  verifyOverlapGuard(runtimeDirectory),
  readStageEvidence("preflight"),
  readStageEvidence("stages"),
  readStageEvidence("web"),
  readStageEvidence("browser")
]);

const receipt = buildReceipt({
  identity: {
    request_id: process.env.ATELIER_REQUEST_ID,
    idempotency_key: process.env.ATELIER_IDEMPOTENCY_KEY,
    run_id: process.env.GITHUB_RUN_ID,
    run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    repository: process.env.GITHUB_REPOSITORY,
    requested_sha: process.env.ATELIER_TARGET_SHA,
    profile: process.env.ATELIER_PROFILE,
    profile_version: Number(process.env.ATELIER_PROFILE_VERSION),
    runtime_engine_sha: process.env.ATELIER_RUNTIME_SHA,
    runtime_engine_version: start?.runtime_engine_version ?? "UNKNOWN"
  },
  contract,
  start,
  after,
  environment,
  evidence: { preflight, stages, web, browser },
  stepOutcomes: {
    preflight: process.env.ATELIER_PREFLIGHT_OUTCOME,
    stages: process.env.ATELIER_STAGES_OUTCOME,
    web: process.env.ATELIER_WEB_OUTCOME,
    browser: process.env.ATELIER_BROWSER_OUTCOME
  },
  overlapGuard
});

const validation = validateReceipt(receipt);
if (!validation.ok) {
  for (const error of validation.errors) console.error(`G7_RECEIPT_ERROR=${error}`);
  process.exit(1);
}

const receiptPath = join(evidenceDirectory(), "runtime-receipt.json");
await writeJsonAtomic(receiptPath, receipt);
console.log("G7_RECEIPT_FINALIZED=PASS");
console.log(`G7_RUN_ATTEMPT_BINDING=${Number.isInteger(receipt.run_attempt) && receipt.run_attempt >= 1 ? "PASS" : "FAIL"}`);
console.log(`G7_SHA_BINDING=${receipt.requested_sha === receipt.executed_sha && start?.runtime_engine_sha === receipt.runtime_engine_sha ? "PASS" : "FAIL"}`);
console.log("G7_ENVIRONMENT_EVIDENCE=PASS");
console.log(`G7_SOURCE_INTEGRITY=${receipt.stages.source_integrity}`);
console.log(`G7_OVERLAP_GUARD=${overlapGuard ? "PASS" : "FAIL"}`);
console.log(`G7_RESULT=${receipt.result}`);
if (receipt.failure_stage) console.log(`G7_FAILURE_STAGE=${receipt.failure_stage}`);
if (receipt.failure_reason) console.log(`G7_FAILURE_REASON=${receipt.failure_reason}`);
