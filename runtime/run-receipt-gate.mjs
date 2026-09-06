import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateReceipt } from "./receipt.mjs";

const path = resolve(process.argv[2] ?? "runtime-evidence/runtime-receipt.json");
let receipt;
try {
  receipt = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  console.error(`G7_CANONICAL_PASS_DENIED=RECEIPT_READ_${error?.code ?? error?.name ?? "FAILURE"}`);
  process.exit(1);
}
const validation = validateReceipt(receipt);
if (!validation.ok) {
  console.error(`G7_CANONICAL_PASS_DENIED=${validation.errors.join(",")}`);
  process.exit(1);
}
if (process.env.ATELIER_RECEIPT_FINALIZE_OUTCOME !== "success") {
  console.error("G7_CANONICAL_PASS_DENIED=RECEIPT_FINALIZE_STEP");
  process.exit(1);
}
if (process.env.ATELIER_RECEIPT_UPLOAD_OUTCOME !== "success") {
  console.error("G7_CANONICAL_PASS_DENIED=RECEIPT_UPLOAD_STEP");
  process.exit(1);
}
if (receipt.result !== "PASS") {
  console.error(`G7_CANONICAL_PASS_DENIED=RESULT_${receipt.result}`);
  process.exit(1);
}
console.log("G7_RECEIPT_ARTIFACT=PASS");
console.log("G7_RUNTIME_RECEIPT_GUARDS=PASS");
