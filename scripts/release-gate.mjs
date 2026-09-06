import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateReleasePolicy } from "../runtime/release-policy.mjs";

const execFileAsync = promisify(execFile);

async function gitPaths() {
  const { stdout } = await execFileAsync("git", ["ls-files"], { encoding: "utf8" });
  return stdout.split("\n").filter(Boolean);
}

const [workflowText, versionText, packageText, lockText, securityBoundaryText, scopeLockText, availablePaths] = await Promise.all([
  readFile(".github/workflows/node-web-verify.yml", "utf8"),
  readFile("VERSION", "utf8"),
  readFile("package.json", "utf8"),
  readFile("package-lock.json", "utf8"),
  readFile("docs/SECURITY_BOUNDARY.md", "utf8"),
  readFile("docs/V1_SCOPE_LOCK.md", "utf8"),
  gitPaths()
]);

const result = evaluateReleasePolicy({
  workflowText,
  versionText,
  packageJson: JSON.parse(packageText),
  lockJson: JSON.parse(lockText),
  securityBoundaryText,
  scopeLockText,
  availablePaths
});

if (!result.ok) {
  for (const error of result.errors) console.error(`G8_RELEASE_POLICY_ERROR=${error}`);
  process.exit(1);
}

console.log("G8_RUNTIME_VERSION_BINDING=PASS");
console.log("G8_EXACT_SHA_POLICY=PASS");
console.log("G8_DUAL_CHECKOUT_POLICY=PASS");
console.log("G8_ACTION_SHA_PINNING=PASS");
console.log("G8_SOURCE_WRITE_ZERO_POLICY=PASS");
console.log("G8_RAW_SHELL_INPUT_ZERO_POLICY=PASS");
console.log("G8_AUTO_RETRY_ZERO_POLICY=PASS");
console.log("G8_RELEASE_POLICY=PASS");
