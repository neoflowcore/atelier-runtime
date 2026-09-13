import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FROZEN_TASK_CONTRACT_FIELDS,
  INTERFACE_MANIFEST_SHA256,
  INTERFACE_VERSION,
  TASK_CONTRACT_MACHINE_SCHEMA_SHA256,
  TASK_CONTRACT_SCHEMA_SHA256,
  computeTaskContractHash,
  validateTaskContractV1
} from "../runtime/task-contract-v1.mjs";

const fixtureRoot = process.env.SYNC1_FIXTURE_ROOT;

async function fixture(name) {
  if (!fixtureRoot) throw new Error("SYNC1_FIXTURE_ROOT is required");
  return JSON.parse(await readFile(join(fixtureRoot, name), "utf8"));
}

test("frozen interface identities are exact SYNC-1 values", () => {
  assert.equal(INTERFACE_VERSION, "1.0.0");
  assert.equal(INTERFACE_MANIFEST_SHA256, "90b016211babd4f10b7de7700c54ea6e2db9179563d88502fc1d9983ad47b617");
  assert.equal(TASK_CONTRACT_SCHEMA_SHA256, "6afcf7aa1b7d3d73b28d6195326db22c82774de308664ce85ba52e42fba640e8");
  assert.equal(TASK_CONTRACT_MACHINE_SCHEMA_SHA256, "3bdbb85a7879c8cee2c7eb2f18c3936fac7a44389ec0ae61f0954b9c19660b65");
  assert.equal(FROZEN_TASK_CONTRACT_FIELDS.length, 27);
});

test("A-side valid fixtures validate and reproduce their contract hashes", async () => {
  for (const name of ["valid_01_read_only.json", "valid_02_candidate_write_intent.json", "valid_03_oracle_evidence_only.json"]) {
    const contract = await fixture(name);
    const result = validateTaskContractV1(contract);
    assert.deepEqual(result.errors, [], `${name}: ${result.errors.join(",")}`);
    assert.equal(result.ok, true, name);
    assert.equal(computeTaskContractHash(contract), contract.TASK_CONTRACT_HASH, name);
  }
});

test("A-side forbidden Runtime-owned top-level fields fail closed", async () => {
  for (const name of ["invalid_01_runtime_owned_backend_id.json", "invalid_02_granted_authority_field.json"]) {
    const contract = await fixture(name);
    const result = validateTaskContractV1(contract);
    assert.equal(result.ok, false, name);
    assert.ok(result.errors.includes("TOP_LEVEL:INVALID_FROZEN_FIELDS"), `${name}: ${result.errors.join(",")}`);
  }
});

test("A-side effect/capability mismatch fails closed", async () => {
  const contract = await fixture("invalid_03_effect_capability_mismatch.json");
  const result = validateTaskContractV1(contract);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("MISSING_CAPABILITY")), result.errors.join(","));
});

test("hash mismatch and non-NFC input are rejected without normalization", async () => {
  const contract = await fixture("valid_01_read_only.json");
  contract.TASK_CONTRACT_HASH = "0".repeat(64);
  assert.ok(validateTaskContractV1(contract).errors.includes("TASK_CONTRACT_HASH:MISMATCH"));

  const nonNfc = await fixture("valid_01_read_only.json");
  nonNfc.ACCEPTANCE_REQUIREMENTS[0].TEXT = "Cafe\u0301";
  nonNfc.TASK_CONTRACT_HASH = computeTaskContractHash(nonNfc);
  assert.ok(validateTaskContractV1(nonNfc).errors.includes("STRING:NON_NFC"));
});
