import { resolve } from "node:path";
import { readJson, validateRuntimeContract } from "./preflight.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");

try {
  const [contract, packageJson] = await Promise.all([
    readJson(resolve(targetDirectory, ".atelier/runtime.json")),
    readJson(resolve(targetDirectory, "package.json"))
  ]);
  const result = validateRuntimeContract(contract, packageJson);
  if (!result.ok) {
    for (const error of result.errors) console.error(`G3_PREFLIGHT_ERROR=${error}`);
    process.exitCode = 2;
  } else {
    console.log("G3_CONTRACT_PREFLIGHT=PASS");
  }
} catch (error) {
  console.error(`G3_PREFLIGHT_ERROR=${error?.code ?? error?.name ?? "READ_FAILURE"}`);
  process.exitCode = 2;
}
