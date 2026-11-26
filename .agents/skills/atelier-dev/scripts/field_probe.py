"""Explicit signed, immutable candidate probe; never authorizes production writes."""
import argparse
import json
import sys
from pathlib import Path
from resolve_release import blocked, digest, hex_id, strict_json
from verify_registry import verify


def probe(data, trust, expected, now=None):
    try:
        if trust.get("channel") != "field-candidate" or expected.get("channel") != "field-candidate":
            return blocked("FIELD_TRUST_NOT_SEPARATE")
        if not hex_id(expected["registry_head"], 40) or not hex_id(expected["registry_sha256"], 64) or data["registry_head"] != expected["registry_head"] or digest(data["registry_text"]) != expected["registry_sha256"]:
            return blocked("FIELD_REGISTRY_PIN_MISMATCH")
        registry = strict_json(data["registry_text"])
        entry = expected["candidate"]
        if registry.get("channel") != "field-candidate" or registry["stable"] != [entry] or registry["revoked"] or entry["commit"] == expected["registry_head"]:
            return blocked("FIELD_CANDIDATE_PIN_MISMATCH")
        result = verify({**data, "checkpoint": {k: entry[k] for k in ("id", "commit", "manifest_sha256")}}, trust, now=now, expected_channel="field-candidate")
        if result.get("status") != "BOUND":
            return result
        return {"status": "FIELD_CANDIDATE_BOUND", "mode": "READ_ONLY_FIELD_PROBE", "candidate": result["release"], "registry_head": result["registry_head"], "registry_sha256": result["registry_sha256"], "publisher_verified": True, "observed_features": result["enabled_features"], "write_authority": False, "stable_promotion": False}
    except (KeyError, ValueError, TypeError, AttributeError):
        return blocked("FIELD_PROBE_INPUT_INVALID")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trust", required=True)
    parser.add_argument("--expected", required=True)
    args = parser.parse_args()
    try:
        result = probe(strict_json(sys.stdin.read()), strict_json(Path(args.trust).read_text(encoding="utf-8")), strict_json(Path(args.expected).read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError):
        result = blocked("FIELD_PIN_OR_TRUST_UNAVAILABLE")
    print(json.dumps(result, sort_keys=True))
