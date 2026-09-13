import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildPlanAEvidenceBindingReceipt,
  validatePlanAEvidenceBindingReceipt
} from "./plan-a-evidence-binding.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const workerPath = resolve(process.argv[2] ?? "runtime-evidence/runtime-a-worker-attestation.json");
const foundationPath = resolve(process.argv[3] ?? "runtime-evidence/runtime-a-foundation-receipt.json");
const outputPath = resolve(process.argv[4] ?? "runtime-evidence/runtime-a-evidence-binding.json");

const workerBytes = await readFile(workerPath);
const foundationBytes = await readFile(foundationPath);
const workerReceipt = JSON.parse(workerBytes.toString("utf8"));
const foundationReceipt = JSON.parse(foundationBytes.toString("utf8"));
const workerReceiptSha256 = sha256(workerBytes);
const foundationReceiptSha256 = sha256(foundationBytes);

const receipt = buildPlanAEvidenceBindingReceipt({
  workerReceipt,
  foundationReceipt,
  workerReceiptSha256,
  foundationReceiptSha256
});

const validation = validatePlanAEvidenceBindingReceipt(receipt, {
  workerReceipt,
  foundationReceipt,
  workerReceiptSha256,
  foundationReceiptSha256
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`RUNTIME_A_EVIDENCE_BINDING=${validation.ok ? "VALID" : "INVALID"}`);
console.log(`RUNTIME_A_EVIDENCE_RESULT=${receipt.result}`);
console.log(`RUNTIME_A_WORKER_ATTESTATION_SHA256=${workerReceiptSha256}`);
console.log(`RUNTIME_A_FOUNDATION_RECEIPT_SHA256=${foundationReceiptSha256}`);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
