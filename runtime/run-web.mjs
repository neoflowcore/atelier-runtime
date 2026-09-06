import { resolve } from "node:path";
import { readJson, validateRuntimeContract } from "./preflight.mjs";
import { executeWebHttpRuntime } from "./web-runtime.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");
const [contract, packageJson] = await Promise.all([
  readJson(resolve(targetDirectory, ".atelier/runtime.json")),
  readJson(resolve(targetDirectory, "package.json"))
]);

const preflight = validateRuntimeContract(contract, packageJson);
if (!preflight.ok) {
  for (const error of preflight.errors) console.error(`G5_PREFLIGHT_ERROR=${error}`);
  process.exit(2);
}

const result = await executeWebHttpRuntime(targetDirectory, contract);
if (!result.ok) {
  for (const error of result.errors ?? []) console.error(`G5_PREFLIGHT_ERROR=${error}`);
  if (result.failureReason) console.error(`G5_FAILURE_REASON=${result.failureReason}`);
  console.error(`G5_FAILURE_STAGE=${result.failureStage}`);
  process.exit(result.classification === "BLOCKED" ? 2 : 1);
}

console.log(`G5_DEV_SERVER=${result.devServer}`);
console.log(`G5_HTTP=${result.http}`);
console.log(`G5_CLEANUP=${result.cleanup}`);
console.log("G5_WEB_HTTP_RUNTIME=PASS");
