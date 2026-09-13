import { readFile } from "node:fs/promises";
import { validatePlanAFoundationReceipt } from "./plan-a-foundation.mjs";

const path = process.argv[2] ?? "runtime-evidence/runtime-a-foundation-receipt.json";
const receipt = JSON.parse(await readFile(path, "utf8"));
const validation = validatePlanAFoundationReceipt(receipt);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
if (receipt.result !== "PASS") {
  console.error(`RUNTIME_A_FOUNDATION_GATE=${receipt.result}:${receipt.failure_reason}`);
  process.exit(1);
}
console.log("RUNTIME_A_FOUNDATION_GATE=PASS");
