import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "..", ".github", "workflows", "runtime-a-self-hosted-foundation.yml");
const workflow = await readFile(workflowPath, "utf8");
const foundationRunner = await readFile(join(here, "..", "runtime", "run-plan-a-foundation.mjs"), "utf8");

test("Plan A workflow is callable only and has no automatic or manual trigger", () => {
  assert.match(workflow, /on:\n  workflow_call:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.doesNotMatch(workflow, /\n  pull_request:/);
  assert.doesNotMatch(workflow, /\n  workflow_dispatch:/);
});

test("Plan A runner identity is literal and has no hosted fallback", () => {
  assert.match(workflow, /runs-on: \[self-hosted, linux, x64, atelier-runtime-v1\]/);
  assert.doesNotMatch(workflow, /ubuntu-(?:latest|[0-9.]+)/);
  assert.equal((workflow.match(/runs-on:/g) ?? []).length, 1);
});

test("Plan A request surface contains no shell command args env secrets or runner-label inputs", () => {
  const inputsBlock = workflow.slice(workflow.indexOf("    inputs:"), workflow.indexOf("\npermissions:"));
  for (const forbidden of ["shell", "command", "args", "env", "secrets", "runner", "runner_labels", "repository", "clone_url", "task_contract_path"]) {
    assert.doesNotMatch(inputsBlock, new RegExp(`^      ${forbidden}:`, "m"));
  }
  const names = [...inputsBlock.matchAll(/^      ([A-Za-z0-9_-]+):$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(names, ["idempotency_key", "request_id", "runtime_sha", "target_sha"]);
});

test("Plan A workflow preserves read-only GitHub authority and credential non-persistence", () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /contents: write/);
});

test("all action dependencies are pinned to exact 40-hex SHAs", () => {
  const uses = workflow.split("\n").filter((line) => /^\s*(?:-\s*)?uses:/.test(line));
  assert.ok(uses.length >= 1);
  for (const line of uses) assert.match(line, /uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s*#.*)?$/);
});

test("workflow consumes a fixed Task Contract path through the foundation runner and emits only foundation receipt evidence", () => {
  assert.match(foundationRunner, /join\(targetDirectory, "\.atelier", "task-contract\.json"\)/);
  assert.match(workflow, /runtime-a-foundation-receipt\.json/);
  assert.match(workflow, /run-plan-a-foundation\.mjs/);
  assert.match(workflow, /run-plan-a-foundation-gate\.mjs/);
});


test("worker admission gates target checkout and does not implement Plan D leases", () => {
  const attest = workflow.indexOf("Build self-hosted worker attestation");
  const workerGate = workflow.indexOf("Enforce self-hosted worker admission");
  const targetCheckout = workflow.indexOf("Checkout exact target source");
  assert.ok(attest >= 0 && workerGate > attest && targetCheckout > workerGate);
  assert.match(workflow, /if: steps\.worker_gate\.outcome == 'success'\n        uses: actions\/checkout/);
  assert.match(workflow, /run-plan-a-worker-attestation\.mjs/);
  assert.match(workflow, /run-plan-a-worker-attestation-gate\.mjs/);
  assert.doesNotMatch(workflow, /lease_id|lease_ttl|lease_owner|lease_expir/i);
});

test("Plan A workflow grants no secret or write authority to the self-hosted worker", () => {
  assert.doesNotMatch(workflow, /^secrets:/m);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /actions: write/);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
});
