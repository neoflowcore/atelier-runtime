import { resolve } from "node:path";
import { readJson, validateRuntimeContract } from "./preflight.mjs";
import { writeStageEvidence } from "./evidence.mjs";

const targetDirectory = resolve(process.argv[2] ?? "target");

try {
  const [contract, packageJson] = await Promise.all([
    readJson(resolve(targetDirectory, ".atelier/runtime.json")),
    readJson(resolve(targetDirectory, "package.json"))
  ]);
  const result = validateRuntimeContract(contract, packageJson);
  if (!result.ok) {
    await writeStageEvidence("preflight", { ...result, classification: "BLOCKED", failureStage: "PREFLIGHT", exitCode: 2 });
    for (const error of result.errors) console.error(`G3_PREFLIGHT_ERROR=${error}`);
    process.exitCode = 2;
  } else {
    await writeStageEvidence("preflight", { ok: true, errors: [], exitCode: 0 });
    console.log("G3_CONTRACT_PREFLIGHT=PASS");
  }
} catch (error) {
  const reason = error?.code ?? error?.name ?? "READ_FAILURE";
  await writeStageEvidence("preflight", {
    ok: false,
    classification: "BLOCKED",
    failureStage: "PREFLIGHT",
    failureReason: reason,
    errors: [reason],
    exitCode: 2
  });
  console.error(`G3_PREFLIGHT_ERROR=${reason}`);
  process.exitCode = 2;
}
