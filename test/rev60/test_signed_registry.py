import base64
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".agents/skills/atelier-dev/scripts"))
from verify_registry import verify
from resolve_release import REPO, digest
from test_release_resolver import snapshot

spec = importlib.util.spec_from_file_location("prepare_manifest", ROOT / "tools/atelier-skill/prepare_manifest.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.p = Path(cls.temp.name)
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(cls.p / "private.pem")], check=True, capture_output=True)
        pem = subprocess.check_output(["openssl", "pkey", "-in", str(cls.p / "private.pem"), "-pubout"]).decode()
        cls.trust = {"repository": REPO, "public_key_pem": pem, "key_sha256": digest(pem), "minimum_generation": 1}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def signed(self, generation=2, issued=100, expires=200):
        data, _, _ = snapshot()
        reg = json.loads(data["registry_text"])
        reg.update(generation=generation, issued_at=issued, expires_at=expires)
        text = json.dumps(reg)
        (self.p / "registry").write_bytes(text.encode())
        sig = subprocess.check_output(["openssl", "dgst", "-sha256", "-sign", str(self.p / "private.pem"), str(self.p / "registry")])
        data.update(registry_text=text, registry_signature=base64.b64encode(sig).decode())
        return data

    def test_signature_and_newest(self):
        r = verify(self.signed(), self.trust, now=150)
        self.assertEqual(r["status"], "BOUND")
        self.assertEqual(r["release"]["id"], "6.1.0")
        self.assertFalse(r["write_authority"])

    def test_tamper(self):
        data = self.signed()
        data["registry_text"] += " "
        self.assertEqual(verify(data, self.trust, now=150)["reason"], "REGISTRY_SIGNATURE_INVALID")

    def test_wrong_key_pin(self):
        self.assertEqual(verify(self.signed(), {**self.trust, "key_sha256": "0" * 64}, now=150)["reason"], "PUBLISHER_KEY_MISMATCH")

    def test_expiry(self):
        self.assertEqual(verify(self.signed(), self.trust, now=200)["reason"], "REGISTRY_EXPIRED_OR_FUTURE")

    def test_future(self):
        self.assertEqual(verify(self.signed(), self.trust, now=99)["reason"], "REGISTRY_EXPIRED_OR_FUTURE")

    def test_replay(self):
        state = verify(self.signed(), self.trust, now=150)["verified_registry_state"]
        self.assertEqual(verify(self.signed(1), self.trust, state, now=150)["reason"], "REGISTRY_REPLAY_OR_EQUIVOCATION")

    def test_equivocation(self):
        state = verify(self.signed(), self.trust, now=150)["verified_registry_state"]
        self.assertEqual(verify(self.signed(expires=201), self.trust, state, now=150)["reason"], "REGISTRY_REPLAY_OR_EQUIVOCATION")

    def test_unenrolled_and_floor(self):
        self.assertEqual(verify(self.signed(), {**self.trust, "minimum_generation": 3}, now=150)["reason"], "REGISTRY_GENERATION_INVALID")
        self.assertEqual(verify(self.signed(), {}, now=150)["status"], "BLOCKED")

    def test_prepare_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            (p / "feature.md").write_bytes(b"abc\r\n")
            spec = {"id": "6.0.0", "protocol_min": 1, "protocol_max": 1, "required_capabilities": ["github.read"], "files": [{"path": "feature.md", "kind": "knowledge"}], "features": [{"id": "read", "paths": ["feature.md"], "required_capabilities": ["github.read"]}]}
            m = prepare.prepare(p, spec)
            self.assertEqual(m["files"][0]["sha256"], digest("abc\r\n"))
            spec["files"][0]["path"] = "../feature.md"
            with self.assertRaises(ValueError):
                prepare.prepare(p, spec)


if __name__ == "__main__":
    unittest.main()
