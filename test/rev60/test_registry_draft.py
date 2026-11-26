import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".agents/skills/atelier-dev/scripts"))
from ci_evidence import verify
from resolve_release import REPO, digest
from test_execution_evidence import evidence
from test_release_resolver import snapshot
spec = importlib.util.spec_from_file_location("prepare_registry", ROOT / "tools/atelier-skill/prepare_registry.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    d, new, old = snapshot()
    c = d["snapshots"][new["commit"]]
    e = evidence(); e["expected"]["repository"] = REPO; e["run"]["repository"]["full_name"] = REPO
    return {"candidate": {"commit": new["commit"], **c}, "ci_receipt": verify(e), "required_jobs": {"verify": ["test"]}, "required_artifacts": ["run-1-attempt-1-evidence"], "initial_registry": True, "minimum_generation": 1, "generation": 1, "issued_at": 100, "expires_at": 200, "capabilities": ["github.read"]}, old


class DraftTests(unittest.TestCase):
    def test_initial_unsigned_draft(self):
        d, _ = fixture(); r = module.prepare(d)
        self.assertEqual(r["status"], "UNSIGNED_REGISTRY_DRAFT", r)
        self.assertTrue(r["signature_required"])
        self.assertTrue(r["human_promotion_required"])
        self.assertFalse(r["write_authority"])

    def test_wrong_evidence_or_missing_step(self):
        d, _ = fixture(); d["ci_receipt"]["evidence"]["head"] = "0" * 40
        self.assertEqual(module.prepare(d)["reason"], "CANDIDATE_CI_EVIDENCE_MISMATCH")
        d, _ = fixture(); d["required_jobs"]["verify"].append("missing")
        self.assertEqual(module.prepare(d)["reason"], "CANDIDATE_REQUIRED_STEPS_MISSING")

    def test_no_first_registry_without_explicit_review(self):
        d, _ = fixture(); d["initial_registry"] = False
        self.assertEqual(module.prepare(d)["reason"], "FIRST_REGISTRY_REVIEW_REQUIRED")

    def test_prior_generation_and_revocation(self):
        d, old = fixture(); previous = json.dumps({"schema": 1, "repository": REPO, "generation": 1, "stable": [old], "revoked": []})
        d.update(previous_registry_text=previous, previous_registry_state={"repository": REPO, "generation": 1, "registry_sha256": digest(previous)}, revoke=[old["id"]], generation=2)
        r = module.prepare(d)
        self.assertEqual(r["status"], "UNSIGNED_REGISTRY_DRAFT", r)
        self.assertEqual(json.loads(r["registry_text"])["revoked"], [old["id"]])
        d["generation"] = 1
        self.assertEqual(module.prepare(d)["reason"], "REGISTRY_GENERATION_OR_TIME_INVALID")

    def test_changed_manifest_bytes(self):
        d, _ = fixture(); d["candidate"]["files"]["docs/feature.md"] = "tampered"
        self.assertEqual(module.prepare(d)["reason"], "CANDIDATE_MANIFEST_OR_COMPATIBILITY_INVALID")


if __name__ == "__main__":
    unittest.main()
