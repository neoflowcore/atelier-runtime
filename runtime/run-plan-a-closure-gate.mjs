import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePlanAClosureReceipt } from "./plan-a-closure.mjs";

const receiptPath = resolve(process.argv[2] ?? "runtime-evidence/runtime-a-plan-a-closure.json");
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const validation = validatePlanAClosureReceipt(receipt);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
if (receipt.result !== "PASS") {
  console.error(`RUNTIME_A_PLAN_A_CLOSURE_GATE=FAIL reason=${receipt.failure_reason ?? receipt.result}`);
  process.exit(1);
}
console.log(`RUNTIME_A_PLAN_A_CLOSURE_GATE=PASS candidate=${receipt.candidate_sha} tree=${receipt.candidate_tree}`);
