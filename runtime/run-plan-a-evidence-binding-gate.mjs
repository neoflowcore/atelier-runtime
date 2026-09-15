import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePlanAEvidenceBindingReceipt } from "./plan-a-evidence-binding.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const bindingPath = resolve(process.argv[2] ?? "runtime-evidence/runtime-a-evidence-binding.json");
const workerPath = resolve(process.argv[3] ?? "runtime-evidence/runtime-a-worker-attestation.json");
const foundationPath = resolve(process.argv[4] ?? "runtime-evidence/runtime-a-foundation-receipt.json");
const [bindingBytes, workerBytes, foundationBytes] = await Promise.all([
  readFile(bindingPath),
  readFile(workerPath),
  readFile(foundationPath)
]);
const receipt = JSON.parse(bindingBytes.toString("utf8"));
const workerReceipt = JSON.parse(workerBytes.toString("utf8"));
const foundationReceipt = JSON.parse(foundationBytes.toString("utf8"));
const validation = validatePlanAEvidenceBindingReceipt(receipt, {
  workerReceipt,
  foundationReceipt,
  workerReceiptSha256: sha256(workerBytes),
  foundationReceiptSha256: sha256(foundationBytes)
});

if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
if (receipt.result !== "PASS") {
  console.error(`RUNTIME_A_EVIDENCE_GATE=FAIL result=${receipt.result} reason=${receipt.failure_reason}`);
  process.exit(1);
}
console.log(`RUNTIME_A_EVIDENCE_GATE=PASS worker=${receipt.worker_attestation_sha256} foundation=${receipt.foundation_receipt_sha256}`);
