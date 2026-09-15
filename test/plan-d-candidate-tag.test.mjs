import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuntimeDCandidateTagEnvelope,
  evaluateRuntimeDCandidateTagActivation,
  verifyRuntimeDCandidateTagEnvelope
} from "../runtime/plan-d-candidate-tag.mjs";

const HASH = "a".repeat(64);
const APPROVAL_SHA = "b".repeat(64);
const MERGE_SHA = "c".repeat(64);
const COMMIT = "d".repeat(40);

function build(overrides = {}) {
  return buildRuntimeDCandidateTagEnvelope({
    task_contract_hash: HASH,
    approval_evidence_sha256: APPROVAL_SHA,
    merge_envelope_sha256: MERGE_SHA,
    repository: "neoflowcore/atelier-runtime",
    tag_name: "rc/runtime-d2-v1",
    target_commit_sha: COMMIT,
    candidate_ref: "candidate-a",
    candidate_readback: {
      repository: "neoflowcore/atelier-runtime",
      candidate_ref: "candidate-a",
      observed_head_sha: COMMIT
    },
    ...overrides
  });
}

test("candidate tag binds exact target without deploy authority", () => {
  const result = build();
  assert.equal(result.ok, true);
  assert.equal(result.envelope.candidate_tag_does_not_imply_deploy, true);
  assert.equal(result.envelope.production_deploy_authority, "NONE");
  assert.equal(result.envelope.production_release_authority, "NONE");
  assert.deepEqual(verifyRuntimeDCandidateTagEnvelope(result.envelope), { ok: true, errors: [] });
});

test("candidate readback mismatch blocks tag coordination", () => {
  const result = build({
    candidate_readback: {
      repository: "neoflowcore/atelier-runtime",
      candidate_ref: "candidate-a",
      observed_head_sha: "e".repeat(40)
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("READBACK_TARGET_COMMIT_MISMATCH"));
});

test("tampered tag envelope fails digest verification", () => {
  const envelope = build().envelope;
  const tampered = { ...envelope, tag_name: "rc/other" };
  const checked = verifyRuntimeDCandidateTagEnvelope(tampered);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.includes("TAG_ENVELOPE_SHA256_MISMATCH"));
});

test("candidate tag activation remains deferred and implies no deploy", () => {
  const activation = evaluateRuntimeDCandidateTagActivation(build().envelope);
  assert.equal(activation.ok, true);
  assert.equal(activation.provider_mutation_allowed, false);
  assert.equal(activation.deploy_implied, false);
  assert.equal(activation.production_authority, "NONE");
});
