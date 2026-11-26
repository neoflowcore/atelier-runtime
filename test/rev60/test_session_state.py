import base64
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".agents/skills/atelier-dev/scripts"))
from resolve_release import REPO, digest
from session_state import enroll, bind, advance
from github_snapshot import collect, blob_id, PREFIX
from mutation_guard import compile_proposal, reconcile
from test_release_resolver import snapshot


def context(run="r1"):
    return {"run_id": run, "project_sha256": "a" * 64, "plan_sha256": "b" * 64, "repository": "neoflowcore/target", "branch": "pilote-CS-test", "head": "c" * 40, "tree": "d" * 40}


class StateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.key = cls.root / "private.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(cls.key)], check=True, capture_output=True)
        cls.pem = subprocess.check_output(["openssl", "pkey", "-in", str(cls.key), "-pubout"]).decode()
        cls.trust = {"repository": REPO, "public_key_pem": cls.pem, "key_sha256": digest(cls.pem), "minimum_generation": 1}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.local = tempfile.TemporaryDirectory(dir=self.root)
        self.directory = Path(self.local.name) / "state"
        enroll(self.directory, self.pem, digest(self.pem), 1)

    def tearDown(self):
        self.local.cleanup()

    def sign(self, data, generation=2, only_old=False):
        reg = json.loads(data["registry_text"])
        if only_old:
            reg["stable"] = reg["stable"][1:]
        reg.update(generation=generation, issued_at=100, expires_at=200)
        text = json.dumps(reg)
        sig = subprocess.check_output(["openssl", "dgst", "-sha256", "-sign", str(self.key)], input=text.encode())
        return {**data, "registry_text": text, "registry_signature": base64.b64encode(sig).decode()}

    def test_enrollment_cannot_overwrite(self):
        with self.assertRaises(FileExistsError):
            enroll(self.directory, self.pem, digest(self.pem), 1)

    def test_missing_state_fail_closed(self):
        self.assertEqual(bind(self.directory / "missing", {}, context(), now=150)["status"], "BLOCKED")

    def test_same_install_new_release_and_resume_pin(self):
        data, new, old = snapshot()
        a = self.sign(data, 1, True)
        self.assertEqual(bind(self.directory, a, context(), now=150)["release"]["id"], old["id"])
        b = self.sign(data, 2)
        self.assertEqual(bind(self.directory, b, context("r2"), now=150)["release"]["id"], new["id"])
        self.assertEqual(bind(self.directory, b, context(), resume=True, now=150)["release"]["id"], old["id"])
        self.assertEqual(bind(self.directory, a, context("r3"), now=150)["reason"], "REGISTRY_REPLAY_OR_EQUIVOCATION")

    def test_duplicate_and_drift(self):
        d = self.sign(snapshot()[0])
        bind(self.directory, d, context(), now=150)
        self.assertEqual(bind(self.directory, d, context(), now=150)["reason"], "RUN_ALREADY_BOUND_USE_RESUME")
        self.assertEqual(bind(self.directory, d, {**context(), "head": "e" * 40}, resume=True, now=150)["reason"], "CHECKPOINT_MISSING_OR_PROJECT_DRIFT")

    def test_checkpoint_cas(self):
        bind(self.directory, self.sign(snapshot()[0]), context(), now=150)
        ctx = context()
        r = {"status": "REMOTE_EFFECT_VERIFIED", "repository": ctx["repository"], "branch": ctx["branch"], "base_head": ctx["head"], "head": "e" * 40, "tree": "f" * 40, "proposal_sha256": "1" * 64}
        self.assertEqual(advance(self.directory, ctx, 0, r)["revision"], 1)
        self.assertEqual(advance(self.directory, ctx, 0, r)["reason"], "CHECKPOINT_CAS_REJECTED")

    def transport(self, tamper=False, drift=False):
        data, new, _ = snapshot()
        data = self.sign(data)
        files = {".atelier/releases/registry.v1.json": data["registry_text"], ".atelier/releases/registry.v1.sig": data["registry_signature"]}
        head = data["registry_head"]
        release = data["snapshots"][new["commit"]]
        release_files = {".atelier/releases/manifest.v1.json": release["manifest_text"], **release["files"]}
        calls = []
        def get(path):
            calls.append(path)
            if path == PREFIX + "/branches/main":
                return {"commit": {"sha": "0" * 40 if drift and calls.count(path) > 1 else head}}
            for sha, tree, fs in [(head, "e" * 40, files), (new["commit"], new["tree"], release_files)]:
                if path == PREFIX + "/git/commits/" + sha:
                    return {"sha": sha, "tree": {"sha": tree}}
                if path == PREFIX + "/git/trees/" + tree + "?recursive=1":
                    return {"sha": tree, "truncated": False, "tree": [{"path": p, "sha": blob_id(v.encode()), "mode": "100644", "type": "blob"} for p, v in fs.items()]}
                for p, v in fs.items():
                    if path == PREFIX + "/contents/" + p + "?ref=" + sha:
                        raw = v.encode()
                        return {"type": "file", "encoding": "base64", "sha": blob_id(raw), "content": base64.b64encode(raw + (b"x" if tamper and p == "docs/feature.md" else b"")).decode()}
            raise ValueError(path)
        return get

    def test_collect_immutable_snapshot(self):
        r = collect(self.transport(), self.trust, ["github.read"], now=150)
        self.assertEqual(r["status"], "SNAPSHOT_COLLECTED")
        self.assertEqual(bind(self.directory, r["snapshot"], context(), now=150)["status"], "BOUND")

    def test_collector_tamper_and_head_drift(self):
        self.assertEqual(collect(self.transport(tamper=True), self.trust, ["github.read"], now=150)["status"], "BLOCKED")
        self.assertEqual(collect(self.transport(drift=True), self.trust, ["github.read"], now=150)["reason"], "REGISTRY_HEAD_CHANGED_RETRY_READ")


class MutationTests(unittest.TestCase):
    def fixture(self):
        ctx = context()
        return {"context": ctx, "grant": {**ctx, "scope": "NON_DESTRUCTIVE_SOURCE_DEVELOPMENT", "expires_at": 200, "allowed_prefixes": ["src"]}, "observation": ctx, "operation": "source.commit", "force": False, "destructive": False, "changes": [{"path": "src/a.txt", "mode": "100644", "content": "hello"}]}

    def test_proposal_no_authority(self):
        r = compile_proposal(self.fixture(), now=150)
        self.assertEqual(r["status"], "ADVISORY_PROPOSAL")
        self.assertFalse(r["write_authority"])

    def test_grant_drift_and_expiry(self):
        f = self.fixture()
        self.assertEqual(compile_proposal(f, now=200)["status"], "BLOCKED")
        f["grant"]["repository"] = "other/repo"
        self.assertEqual(compile_proposal(f, now=150)["status"], "BLOCKED")

    def test_forbidden_operations_and_paths(self):
        for path in ["src/../secret", "src/.env", "src/.git/x", "other/a"]:
            f = self.fixture(); f["changes"][0]["path"] = path
            self.assertEqual(compile_proposal(f, now=150)["status"], "BLOCKED")
        f = self.fixture(); f["operation"] = "merge"
        self.assertEqual(compile_proposal(f, now=150)["status"], "BLOCKED")
        f = self.fixture(); f["force"] = True
        self.assertEqual(compile_proposal(f, now=150)["status"], "BLOCKED")

    def test_readback_exact_and_unknown(self):
        f = self.fixture(); p = compile_proposal(f, now=150)
        data = {**p, "observation": {**context(), "head": "e" * 40, "tree": "f" * 40}, "candidate": {"head": "e" * 40, "tree": "f" * 40, "parents": [context()["head"]], "files": p["proposal"]["files"]}}
        self.assertEqual(reconcile(data)["status"], "REMOTE_EFFECT_VERIFIED")
        data["candidate"]["files"] = {**data["candidate"]["files"], "src/extra": "a" * 40}
        self.assertEqual(reconcile(data)["reason"], "OUTCOME_UNKNOWN_RECONCILE_REQUIRED")
        data["observation"] = context()
        self.assertEqual(reconcile(data)["status"], "BASE_OBSERVED_RECOMPILE_REQUIRED")


if __name__ == "__main__":
    unittest.main()
