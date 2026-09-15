import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildPlanAClosureReceipt, validatePlanAClosureReceipt } from "./plan-a-closure.mjs";

const rootDirectory = resolve(process.argv[2] ?? ".");
const remoteSnapshotPath = resolve(process.argv[3] ?? "runtime-a-remote-snapshot.json");
const outputPath = resolve(process.argv[4] ?? "runtime-evidence/runtime-a-plan-a-closure.json");
const manifestPath = resolve(rootDirectory, "fixtures/runtime-a/plan-a-component-manifest.json");

const [manifestBytes, remoteSnapshot] = await Promise.all([
  readFile(manifestPath),
  readFile(remoteSnapshotPath, "utf8").then(JSON.parse)
]);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const receipt = await buildPlanAClosureReceipt({ rootDirectory, manifest, manifestSha256, remoteSnapshot });
const validation = validatePlanAClosureReceipt(receipt);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`RUNTIME_A_PLAN_A_CLOSURE_RECEIPT=${validation.ok ? "VALID" : "INVALID"}`);
console.log(`RUNTIME_A_PLAN_A_CANDIDATE_CLASS=${receipt.candidate_class}`);
console.log(`RUNTIME_A_PLAN_A_CLOSURE_RESULT=${receipt.result}`);
console.log(`RUNTIME_A_SYNC2_STATE=${receipt.sync2_state}`);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(2);
}
