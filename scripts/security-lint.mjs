import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const workflowDir = ".github/workflows";
const files = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/.test(name));
const failures = [];
const fullShaUse = /^\s*uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s*#.*)?$/;
const forbiddenInput = /^\s{6}(shell|command|args|env|secrets|repository|clone_url):\s*$/;

for (const file of files) {
  const text = await readFile(join(workflowDir, file), "utf8");
  if (!/^permissions:\n\s+contents:\s+read\s*$/m.test(text)) {
    failures.push(`${file}: permissions must be contents: read`);
  }
  if (/persist-credentials:\s*true/.test(text)) failures.push(`${file}: persisted credentials`);
  for (const line of text.split("\n")) {
    if (/^\s*uses:/.test(line) && !fullShaUse.test(line)) failures.push(`${file}: floating action: ${line.trim()}`);
    if (forbiddenInput.test(line)) failures.push(`${file}: forbidden workflow input: ${line.trim()}`);
  }
}

for (const schema of ["schemas/runtime-contract.schema.json", "schemas/runtime-receipt.schema.json"]) {
  JSON.parse(await readFile(schema, "utf8"));
}
const version = (await readFile("VERSION", "utf8")).trim();
if (!version) failures.push("VERSION is empty");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`SECURITY_LINT=PASS workflows=${files.length}`);
