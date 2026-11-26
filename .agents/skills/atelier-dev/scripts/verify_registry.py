"""Verify a signed registry using a separately enrolled local trust anchor."""
import argparse
import base64
import json
import subprocess
import tempfile
import time
from pathlib import Path
from resolve_release import REPO, blocked, digest, hex_id, resolve, strict_json


def verify(data, trust, previous=None, now=None, *, expected_channel="stable"):
    try:
        now = int(time.time()) if now is None else now
        if expected_channel not in {"stable", "field-candidate"} or trust.get("channel", "stable") != expected_channel:
            return blocked("PUBLISHER_CHANNEL_MISMATCH")
        if trust["repository"] != REPO or not hex_id(trust["key_sha256"], 64):
            return blocked("PUBLISHER_TRUST_NOT_ENROLLED")
        pem = trust["public_key_pem"]
        if digest(pem) != trust["key_sha256"] or not pem.startswith("-----BEGIN PUBLIC KEY-----"):
            return blocked("PUBLISHER_KEY_MISMATCH")
        text = data["registry_text"]
        sig = base64.b64decode(data["registry_signature"], validate=True)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            (p / "key.pem").write_bytes(pem.encode("utf-8"))
            (p / "registry").write_bytes(text.encode("utf-8"))
            (p / "signature").write_bytes(sig)
            result = subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(p / "key.pem"), "-signature", str(p / "signature"), str(p / "registry")], capture_output=True, timeout=10)
        if result.returncode != 0:
            return blocked("REGISTRY_SIGNATURE_INVALID")
        reg = strict_json(text)
        if reg.get("channel", "stable") != expected_channel:
            return blocked("REGISTRY_CHANNEL_MISMATCH")
        generation, issued, expires = (reg[k] for k in ("generation", "issued_at", "expires_at"))
        floor = trust["minimum_generation"]
        if any(type(v) is not int for v in (generation, issued, expires, floor, now)) or floor < 1 or generation < floor:
            return blocked("REGISTRY_GENERATION_INVALID")
        if not 0 < issued <= now < expires or expires - issued > 90 * 86400:
            return blocked("REGISTRY_EXPIRED_OR_FUTURE")
        if previous is not None:
            if previous.get("channel", "stable") != expected_channel or previous["repository"] != REPO or previous["key_sha256"] != trust["key_sha256"] or type(previous["generation"]) is not int or not hex_id(previous["registry_sha256"], 64):
                return blocked("REGISTRY_CHECKPOINT_INVALID")
            if generation < previous["generation"] or (generation == previous["generation"] and digest(text) != previous["registry_sha256"]):
                return blocked("REGISTRY_REPLAY_OR_EQUIVOCATION")
        result = resolve({**data, "trusted_registry": True})
        result["publisher_verified"] = True
        result["verified_registry_state"] = {"repository": REPO, "key_sha256": trust["key_sha256"], "generation": generation, "registry_sha256": digest(text), "channel": expected_channel}
        return result
    except (KeyError, TypeError, ValueError, AttributeError, OSError, subprocess.SubprocessError):
        return blocked("REGISTRY_VERIFICATION_UNAVAILABLE_OR_INVALID")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trust", required=True, help="Independently enrolled local trust JSON; never fetch from registry")
    parser.add_argument("--previous", help="Previously accepted registry state from trusted durable storage")
    args = parser.parse_args()
    try:
        import sys
        trust = strict_json(Path(args.trust).read_text(encoding="utf-8"))
        previous = strict_json(Path(args.previous).read_text(encoding="utf-8")) if args.previous else None
        result = verify(strict_json(sys.stdin.read()), trust, previous)
    except (OSError, ValueError, TypeError):
        result = blocked("PUBLISHER_TRUST_OR_INPUT_UNAVAILABLE")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
