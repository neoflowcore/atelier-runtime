import importlib.util
import json
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[2] / ".agents/skills/atelier-dev/scripts/resolve_release.py"
spec = importlib.util.spec_from_file_location("resolver", path)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def release(name, sequence, commit, minimum=1, caps=None):
    files = {"docs/feature.md": "verified feature"}
    m = {"schema": 1, "repository": r.REPO, "id": name, "protocol_min": minimum, "protocol_max": minimum, "required_capabilities": caps or ["github.read"], "files": [{"path": "docs/feature.md", "sha256": r.digest(files["docs/feature.md"]), "kind": "knowledge"}], "features": [{"id": "read", "required_capabilities": ["github.read"], "paths": ["docs/feature.md"]}, {"id": "execute", "required_capabilities": ["runtime.execute"], "paths": ["docs/feature.md"]}]}
    text = json.dumps(m)
    return {"id": name, "sequence": sequence, "commit": commit * 40, "tree": "f" * 40, "manifest_sha256": r.digest(text)}, {"tree": "f" * 40, "manifest_text": text, "files": files}


def snapshot(new_min=1, new_caps=None):
    a, sa = release("6.1.0", 2, "a", new_min, new_caps)
    b, sb = release("6.0.0", 1, "b")
    registry = {"schema": 1, "repository": r.REPO, "stable": [a, b], "revoked": []}
    return {"registry_head": "c" * 40, "trusted_registry": True, "registry_text": json.dumps(registry), "snapshots": {a["commit"]: sa, b["commit"]: sb}, "capabilities": ["github.read"]}, a, b


class ResolverTests(unittest.TestCase):
    def test_newest_compatible(self):
        d, a, _ = snapshot()
        result = r.resolve(d)
        self.assertEqual(result["release"], a)
        self.assertEqual(result["enabled_features"], ["read"])
        self.assertEqual(result["disabled_features"], ["execute"])
        self.assertFalse(result["write_authority"])

    def test_new_capability_enables_feature(self):
        d, _, _ = snapshot()
        d["capabilities"].append("runtime.execute")
        self.assertIn("execute", r.resolve(d)["enabled_features"])

    def test_protocol_fallback(self):
        d, a, b = snapshot(new_min=2)
        self.assertEqual(r.resolve(d)["release"], b)
        self.assertEqual(r.resolve(d)["skipped_incompatible"], [a["id"]])

    def test_capability_fallback(self):
        d, _, b = snapshot(new_caps=["github.read", "runtime.execute"])
        self.assertEqual(r.resolve(d)["release"], b)

    def test_resume_pinned(self):
        d, _, b = snapshot()
        d["checkpoint"] = b
        self.assertEqual(r.resolve(d)["release"], b)

    def test_resume_incompatible(self):
        d, a, _ = snapshot(new_min=2)
        d["checkpoint"] = a
        self.assertEqual(r.resolve(d)["reason"], "CHECKPOINT_INCOMPATIBLE")

    def test_revocation_blocks_resume(self):
        d, a, b = snapshot()
        reg = json.loads(d["registry_text"])
        reg["revoked"] = [a["id"]]
        d["registry_text"] = json.dumps(reg)
        self.assertEqual(r.resolve(d)["release"], b)
        d["checkpoint"] = a
        self.assertEqual(r.resolve(d)["reason"], "CHECKPOINT_RELEASE_UNAVAILABLE")

    def test_untrusted(self):
        d, _, _ = snapshot()
        d["trusted_registry"] = False
        self.assertEqual(r.resolve(d)["reason"], "REGISTRY_TRUST_UNVERIFIED")

    def test_empty_stable(self):
        d, _, _ = snapshot()
        d["registry_text"] = json.dumps({"schema": 1, "repository": r.REPO, "stable": [], "revoked": []})
        self.assertEqual(r.resolve(d)["reason"], "NO_STABLE_RELEASE")

    def test_tampered_manifest(self):
        d, a, _ = snapshot()
        d["snapshots"][a["commit"]]["manifest_text"] += " "
        self.assertEqual(r.resolve(d)["reason"], "MANIFEST_INTEGRITY_FAILURE")

    def test_tampered_module(self):
        d, a, _ = snapshot()
        d["snapshots"][a["commit"]]["files"]["docs/feature.md"] = "changed"
        self.assertEqual(r.resolve(d)["reason"], "FILE_INTEGRITY_FAILURE")

    def test_wrong_tree(self):
        d, a, _ = snapshot()
        d["snapshots"][a["commit"]]["tree"] = "0" * 40
        self.assertEqual(r.resolve(d)["reason"], "RELEASE_IDENTITY_UNVERIFIED")

    def test_invalid_order(self):
        d, _, _ = snapshot()
        reg = json.loads(d["registry_text"])
        reg["stable"].reverse()
        d["registry_text"] = json.dumps(reg)
        self.assertEqual(r.resolve(d)["reason"], "REGISTRY_ORDER_INVALID")

    def test_duplicate_registry_keys(self):
        d, _, _ = snapshot()
        d["registry_text"] = d["registry_text"].replace('"schema": 1', '"schema": 1, "schema": 1')
        self.assertEqual(r.resolve(d)["reason"], "INVALID_OR_INCOMPLETE_SNAPSHOT")

    def test_invalid_input(self):
        self.assertEqual(r.resolve({})["reason"], "REGISTRY_TRUST_UNVERIFIED")
        self.assertFalse(r.resolve(None)["write_authority"])


if __name__ == "__main__":
    unittest.main()
