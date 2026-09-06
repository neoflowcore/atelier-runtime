import { resolve } from "node:path";
import { readJson, validateRuntimeContract } from "./preflight.mjs";
import { executeLockedStages } from "./stages.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");
const [contract, packageJson] = await Promise.all([
  readJson(resolve(targetDirectory, ".atelier/runtime.json")),
  readJson(resolve(targetDirectory, "package.json"))
]);
const preflight = validateRuntimeContract(contract, packageJson);
if (!preflight.ok) {
  for (const error of preflight.errors) console.error(`G4_PREFLIGHT_ERROR=${error}`);
  process.exit(2);
}
const result = await executeLockedStages(targetDirectory, contract);
if (!result.ok) {
  console.error(`G4_FAILURE_STAGE=${result.failureStage}`);
  process.exit(result.exitCode);
}
console.log("G4_LOCKED_STAGES=PASS");
