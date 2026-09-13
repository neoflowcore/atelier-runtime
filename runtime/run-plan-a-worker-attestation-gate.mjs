import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePlanAWorkerAttestationReceipt } from "./worker-attestation-plan-a.mjs";

const receiptPath = resolve(process.argv[2] ?? "runtime-evidence/runtime-a-worker-attestation.json");
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const validation = validatePlanAWorkerAttestationReceipt(receipt);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
if (receipt.result !== "PASS") {
  console.error(`RUNTIME_A_WORKER_GATE=FAIL result=${receipt.result} reason=${receipt.failure_reason}`);
  process.exit(1);
}
console.log(`RUNTIME_A_WORKER_GATE=PASS fingerprint=${receipt.worker_fingerprint_sha256}`);
