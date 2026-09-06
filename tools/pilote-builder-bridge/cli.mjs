import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeApplyBundle } from "./builder-bridge.mjs";

const defaults = {
  schema: "fixtures/pilote-builder/rev39/PILOTE_REV39_ACTIONS_OPENAPI_CANDIDATE_v002.yaml",
  policy: "fixtures/pilote-builder/rev39/baseline-operation-ids.json",
  out: "builder-apply-bundle"
};

function parseArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--schema", "--policy", "--out"].includes(arg)) throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`MISSING_VALUE:${arg}`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const [schemaText, policyText] = await Promise.all([
    readFile(resolve(options.schema), "utf8"),
    readFile(resolve(options.policy), "utf8")
  ]);
  const policy = JSON.parse(policyText);
  const bundle = await writeApplyBundle({ schemaText, policy, outputDir: resolve(options.out) });
  const { receipt } = bundle.validation;
  console.log(`R39_P1A_BUILDER_BRIDGE=${receipt.result}`);
  console.log(`SCHEMA_SHA256=${receipt.schema_sha256}`);
  console.log(`OPERATION_TOTAL=${receipt.operation_total}`);
  console.log(`OPERATION_UNIQUE=${receipt.operation_unique}`);
  console.log(`BASELINE_PRESERVED=${receipt.baseline_preserved}`);
  console.log(`EXACT_EXPECTED_ADDITIONS=${receipt.exact_expected_additions}`);
  console.log(`FORBIDDEN_SURFACE_ZERO=${receipt.forbidden_surface_zero}`);
  console.log(`NULL_VALUE_ZERO=${receipt.null_value_zero}`);
  console.log(`BUNDLE_DIR=${resolve(options.out)}`);
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exit(1);
}
