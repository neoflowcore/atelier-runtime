import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".agents/skills/atelier-dev/scripts"))
sys.path.insert(0, str(ROOT / "tools/atelier-skill"))
from resolve_release import REPO, digest
from verify_registry import verify
from field_probe import probe
from surface_policy import evaluate
from surface_fixture import surface_fixture
from execution_protocol import step, runtime_binding, reconcile_only
from mutation_guard import compile_proposal
from audit_candidate import audit
from feature_router import route
from test_execution_evidence import fixture
from test_release_resolver import snapshot


class FieldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.key = Path(cls.tmp.name) / "key.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(cls.key)], check=True, capture_output=True)
        pem = subprocess.check_output(["openssl", "pkey", "-in", str(cls.key), "-pubout"]).decode()
        cls.trust = {"repository": REPO, "public_key_pem": pem, "key_sha256": digest(pem), "minimum_generation": 1, "channel": "field-candidate"}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def signed(self):
        data, new, _ = snapshot()
        reg = json.loads(data["registry_text"])
        reg.update(channel="field-candidate", stable=[new], generation=1, issued_at=100, expires_at=200)
        text = json.dumps(reg)
        sig = subprocess.check_output(["openssl", "dgst", "-sha256", "-sign", str(self.key)], input=text.encode())
        data.update(registry_text=text, registry_signature=base64.b64encode(sig).decode())
        expected = {"channel": "field-candidate", "registry_head": data["registry_head"], "registry_sha256": digest(text), "candidate": new}
        return data, expected

    def test_field_signed_candidate_only(self):
        data, expected = self.signed()
        result = probe(data, self.trust, expected, now=150)
        self.assertEqual(result["status"], "FIELD_CANDIDATE_BOUND")
        self.assertFalse(result["write_authority"])
        self.assertFalse(result["stable_promotion"])

    def test_field_never_stable(self):
        data, expected = self.signed()
        stable_trust = {**self.trust, "channel": "stable"}
        self.assertEqual(verify(data, stable_trust, now=150)["reason"], "REGISTRY_CHANNEL_MISMATCH")
        self.assertEqual(probe(data, stable_trust, expected, now=150)["reason"], "FIELD_TRUST_NOT_SEPARATE")

    def test_field_wrong_pin_and_expiry(self):
        data, expected = self.signed()
        self.assertEqual(probe(data, self.trust, {**expected, "registry_head": "0" * 40}, now=150)["reason"], "FIELD_REGISTRY_PIN_MISMATCH")
        self.assertEqual(probe(data, self.trust, expected, now=200)["reason"], "REGISTRY_EXPIRED_OR_FUTURE")
        expected["candidate"] = {**expected["candidate"], "commit": "0" * 40}
        self.assertEqual(probe(data, self.trust, expected, now=150)["reason"], "FIELD_CANDIDATE_PIN_MISMATCH")


class SurfaceTests(unittest.TestCase):
    def test_surface_requires_real_observations(self):
        d = surface_fixture("neoflowcore/target", "pilote-CS-test", 150)
        self.assertEqual(evaluate(d, now=150)["status"], "SURFACE_PRECONDITIONS_OBSERVED")
        d["main_protection"]["status"] = 403
        self.assertEqual(evaluate(d, now=150)["reason"], "SERVER_PROTECTION_UNVERIFIED")
        f = fixture(); f["surface_evidence"] = d
        self.assertEqual(step(f, now=150)["reason"], "SERVER_PROTECTION_UNVERIFIED")

    def test_surface_bypass_staleness_and_cas(self):
        d = surface_fixture("neoflowcore/target", "pilote-CS-test", 150)
        self.assertEqual(evaluate(d, now=451)["reason"], "PROTECTION_OBSERVATION_STALE")
        d["cas_receipt"]["kind"] = "LOCAL_FIXTURE"
        self.assertEqual(evaluate(d, now=150)["reason"], "CAS_NOT_QUALIFIED")
        d["main_protection"]["body"]["required_pull_request_reviews"]["bypass_pull_request_allowances"]["apps"] = ["unknown"]
        self.assertEqual(evaluate(d, now=150)["reason"], "MAIN_REVIEW_OR_BYPASS_UNVERIFIED")

    def test_missing_handoff_feature(self):
        f = fixture(); f["bound_release"]["enabled_features"] = ["runtime.control"]
        self.assertEqual(step(f, now=150)["status"], "BLOCKED")


class LocalGitTests(unittest.TestCase):
    def test_local_git_full_cas_and_reconciliation(self):
        # Local Git backend and synthetic surface observations; NOT a native GitHub qualification.
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            def git(*args, check=True):
                r = subprocess.run(["git", "-C", td, *args], check=check, capture_output=True)
                return r.stdout.decode().strip() if check else r
            def tree_observation(sha):
                entries = []
                for row in git("ls-tree", "-r", "-t", "-z", sha).split("\0"):
                    if not row:
                        continue
                    meta, path = row.split("\t", 1)
                    mode, kind, oid = meta.split(" ")
                    entries.append({"path": path, "mode": mode, "type": kind, "sha": oid})
                return {"sha": sha, "truncated": False, "tree": entries}
            git("init", "-q", "-b", "pilote-CS-test")
            git("config", "user.name", "Local test")
            git("config", "user.email", "test@example.invalid")
            (root / "src").mkdir(); (root / "src/old.txt").write_text("old")
            (root / "README.md").write_text("base")
            git("add", "."); git("commit", "-qm", "base")
            head, base = git("rev-parse", "HEAD"), git("rev-parse", "HEAD^{tree}")
            d = fixture()
            for key in ("context", "grant", "observation"):
                d["original"][key].update(head=head, tree=base)
            d["control_decision"]["identity"].update(head=head, tree=base)
            d["fresh_branch"].update(head=head, tree=base)
            d["base_tree"] = tree_observation(base)
            p = compile_proposal(d["original"], now=150)
            d["proposal_sha256"] = p["proposal_sha256"]
            d["handoff_sha256"] = runtime_binding(d, p)
            req = step(d, now=150)["request"]
            self.assertEqual(req["tool"], "create_tree")
            for e in req["arguments"]["tree_elements"]:
                (root / e["path"]).write_text(e["content"])
            git("add", "."); candidate_tree = git("write-tree")
            d.update(stage="tree_readback", candidate_tree=tree_observation(candidate_tree))
            req = step(d, now=150)["request"]
            self.assertEqual(req["tool"], "create_commit")
            candidate = git("commit-tree", req["arguments"]["tree_sha"], "-p", req["arguments"]["parent_sha"], "-m", req["arguments"]["message"])
            d.update(stage="commit_readback", candidate_commit={"sha": candidate, "tree": {"sha": git("rev-parse", candidate + "^{tree}")}, "parents": [{"sha": x} for x in git("show", "-s", "--format=%P", candidate).split()]})
            req = step(d, now=150)["request"]
            self.assertEqual(req["tool"], "update_ref")
            ref = "refs/heads/" + req["arguments"]["branch_name"]
            rejected = git("update-ref", ref, candidate, "0" * 40, check=False)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(git("rev-parse", ref), head)
            git("update-ref", ref, req["arguments"]["sha"], req["arguments"]["expected_sha"])
            d.update(stage="ref_readback"); d["fresh_branch"].update(head=git("rev-parse", ref), tree=git("rev-parse", ref + "^{tree}"))
            self.assertEqual(step(d, now=150)["status"], "REMOTE_EFFECT_VERIFIED")
            self.assertEqual(step(d, now=201)["status"], "BLOCKED")
            read = reconcile_only({**d, **p})
            self.assertEqual(read["status"], "REMOTE_EFFECT_VERIFIED")
            self.assertFalse(read["write_authority"])


class CandidateAuditTests(unittest.TestCase):
    def test_manifest_and_archive_bytes(self):
        self.assertEqual(audit(ROOT)["status"], "CANDIDATE_AUDIT_PASS")
        skill = ROOT / ".agents/skills/atelier-dev"
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / "skill.zip"
            with zipfile.ZipFile(archive, "w") as z:
                for p in skill.rglob("*"):
                    if p.is_file():
                        z.write(p, "atelier-dev/" + p.relative_to(skill).as_posix())
            r = audit(ROOT, archive)
            self.assertEqual(r["archive"], "BYTES_VERIFIED")
            self.assertEqual(r["archive_sha256"], hashlib.sha256(archive.read_bytes()).hexdigest())
            with zipfile.ZipFile(archive, "a") as z:
                z.writestr("atelier-dev/extra.txt", "unexpected")
            with self.assertRaises(ValueError):
                audit(ROOT, archive)


class FeatureTests(unittest.TestCase):
    def fixture(self):
        name = "new.future.knowledge"
        files = {"docs/new.md": "future feature"}
        manifest = {"schema": 1, "repository": REPO, "id": "7.0.0", "files": [{"path": "docs/new.md", "kind": "knowledge", "sha256": digest(files["docs/new.md"])}], "features": [{"id": name, "handler": "knowledge.read", "required_capabilities": ["github.read"], "paths": ["docs/new.md"]}]}
        text = json.dumps(manifest)
        return {"selection": {"status": "BOUND", "publisher_verified": True, "write_authority": False, "enabled_features": [name], "release": {"id": "7.0.0", "commit": "a" * 40, "manifest_sha256": digest(text)}}, "manifest_text": text, "feature_id": name, "files": files, "capabilities": ["github.read"]}

    def test_future_feature_same_bootstrap(self):
        r = route(self.fixture())
        self.assertEqual(r["status"], "FEATURE_ROUTE_SELECTED")
        self.assertEqual(r["handler"], "knowledge.read")
        self.assertFalse(r["execution_performed"])

    def test_unknown_handler_and_missing_capability(self):
        d = self.fixture(); m = json.loads(d["manifest_text"]); m["features"][0]["handler"] = "arbitrary.shell"
        d["manifest_text"] = json.dumps(m); d["selection"]["release"]["manifest_sha256"] = digest(d["manifest_text"])
        self.assertEqual(route(d)["reason"], "FEATURE_HANDLER_UNSUPPORTED")
        d = self.fixture(); d["capabilities"] = []
        self.assertEqual(route(d)["reason"], "FEATURE_CAPABILITY_MISMATCH")

    def test_tampered_module_or_unbound_feature(self):
        d = self.fixture(); d["files"]["docs/new.md"] = "tampered"
        self.assertEqual(route(d)["reason"], "FEATURE_FILE_INTEGRITY_FAILURE")
        d = self.fixture(); d["selection"]["enabled_features"] = []
        self.assertEqual(route(d)["reason"], "FEATURE_NOT_BOUND_OR_ENABLED")


if __name__ == "__main__":
    unittest.main()
