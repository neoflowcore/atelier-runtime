import { resolve } from "node:path";
import { readJson, validateRuntimeContract } from "./preflight.mjs";
import { executeBrowserRuntime } from "./browser-runtime.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");
const [contract, packageJson] = await Promise.all([
  readJson(resolve(targetDirectory, ".atelier/runtime.json")),
  readJson(resolve(targetDirectory, "package.json"))
]);

const preflight = validateRuntimeContract(contract, packageJson);
if (!preflight.ok) {
  for (const error of preflight.errors) console.error(`G6_PREFLIGHT_ERROR=${error}`);
  process.exit(2);
}

const result = await executeBrowserRuntime(targetDirectory, contract);
if (!result.ok) {
  console.error(`G6_FAILURE_CLASS=${result.classification}`);
  console.error(`G6_FAILURE_REASON=${result.failureReason}`);
  console.error(`G6_FAILURE_STAGE=${result.failureStage}`);
  process.exit(result.classification === "BLOCKED" ? 2 : result.classification === "TIMEOUT" ? 124 : 1);
}

console.log(`G6_PLAYWRIGHT_CLI=${result.playwrightCli}`);
console.log(`G6_CHROMIUM_PROVISION=${result.chromiumProvision}`);
console.log(`G6_BROWSER_SCRIPT=${result.browserScript}`);
console.log("G6_VISUAL_CERTIFICATION=NOT_CLAIMED");
console.log("G6_BROWSER_RUNTIME=PASS");
