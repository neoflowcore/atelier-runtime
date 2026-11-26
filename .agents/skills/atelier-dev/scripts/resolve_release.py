"""Offline, fail-closed release resolver. Input: JSON snapshot on stdin."""
import hashlib
import json
import re
import sys
from pathlib import PurePosixPath

REPO = "neoflowcore/atelier-runtime"
PROTOCOL = 1
KINDS = {"policy", "knowledge", "contract", "adapter", "feature"}


def strict_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("invalid constant")))


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hex_id(value, size):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{%d}" % size, value) is not None


def strings(value):
    return isinstance(value, list) and all(isinstance(x, str) and x for x in value) and len(set(value)) == len(value)


def safe_path(path):
    return isinstance(path, str) and bool(path) and not path.startswith("/") and "\\" not in path and all(p not in {"", ".", ".."} for p in path.split("/")) and str(PurePosixPath(path)) == path


def blocked(reason):
    return {"status": "BLOCKED", "reason": reason, "write_authority": False}


def resolve(data):
    try:
        if data.get("trusted_registry") is not True:
            return blocked("REGISTRY_TRUST_UNVERIFIED")
        if not hex_id(data.get("registry_head"), 40):
            return blocked("REGISTRY_HEAD_INVALID")
        registry_text = data["registry_text"]
        registry = strict_json(registry_text)
        if type(registry["schema"]) is not int or registry["schema"] != 1 or registry["repository"] != REPO or not strings(registry["revoked"]):
            return blocked("REGISTRY_INVALID")
        stable = registry["stable"]
        if not isinstance(stable, list) or not strings(data["capabilities"]):
            return blocked("INPUT_INVALID")
        ids, sequences = [], []
        for e in stable:
            if not isinstance(e["id"], str) or not e["id"] or type(e["sequence"]) is not int or e["sequence"] < 1 or not all(hex_id(e[k], n) for k, n in (("commit", 40), ("tree", 40), ("manifest_sha256", 64))):
                return blocked("REGISTRY_ENTRY_INVALID")
            ids.append(e["id"])
            sequences.append(e["sequence"])
        if len(set(ids)) != len(ids) or len(set(sequences)) != len(sequences) or sequences != sorted(sequences, reverse=True):
            return blocked("REGISTRY_ORDER_INVALID")
        checkpoint = data.get("checkpoint")
        if checkpoint is not None:
            stable = [e for e in stable if all(e[k] == checkpoint[k] for k in ("id", "commit", "manifest_sha256"))]
            if not stable or stable[0]["id"] in registry["revoked"]:
                return blocked("CHECKPOINT_RELEASE_UNAVAILABLE")
        caps = set(data["capabilities"])
        skipped = []
        for e in stable:
            if e["id"] in registry["revoked"]:
                continue
            snapshot = data["snapshots"].get(e["commit"])
            if snapshot is None or snapshot["tree"] != e["tree"]:
                return blocked("RELEASE_IDENTITY_UNVERIFIED")
            manifest_text = snapshot["manifest_text"]
            if digest(manifest_text) != e["manifest_sha256"]:
                return blocked("MANIFEST_INTEGRITY_FAILURE")
            m = strict_json(manifest_text)
            if type(m["schema"]) is not int or m["schema"] != 1 or m["repository"] != REPO or m["id"] != e["id"] or not strings(m["required_capabilities"]) or type(m["protocol_min"]) is not int or type(m["protocol_max"]) is not int or not 1 <= m["protocol_min"] <= m["protocol_max"]:
                return blocked("MANIFEST_INVALID")
            if not m["protocol_min"] <= PROTOCOL <= m["protocol_max"] or not set(m["required_capabilities"]) <= caps:
                if checkpoint is not None:
                    return blocked("CHECKPOINT_INCOMPATIBLE")
                skipped.append(e["id"])
                continue
            if not isinstance(m["files"], list) or not isinstance(m["features"], list):
                return blocked("MANIFEST_INVALID")
            paths = set()
            for f in m["files"]:
                path = f["path"]
                if not safe_path(path) or path in paths or f["kind"] not in KINDS or not hex_id(f["sha256"], 64):
                    return blocked("FILE_ENTRY_INVALID")
                if path not in snapshot["files"] or digest(snapshot["files"][path]) != f["sha256"]:
                    return blocked("FILE_INTEGRITY_FAILURE")
                paths.add(path)
            enabled, disabled, seen = [], [], set()
            for f in m["features"]:
                name = f["id"]
                if not isinstance(name, str) or not name or name in seen or not strings(f["required_capabilities"]) or not strings(f["paths"]) or not set(f["paths"]) <= paths:
                    return blocked("FEATURE_ENTRY_INVALID")
                seen.add(name)
                (enabled if set(f["required_capabilities"]) <= caps else disabled).append(name)
            return {"status": "BOUND", "release": e, "registry_head": data["registry_head"], "registry_sha256": digest(registry_text), "enabled_features": enabled, "disabled_features": disabled, "skipped_incompatible": skipped, "write_authority": False}
        return blocked("NO_COMPATIBLE_STABLE_RELEASE" if skipped else "NO_STABLE_RELEASE")
    except (KeyError, TypeError, ValueError, AttributeError):
        return blocked("INVALID_OR_INCOMPLETE_SNAPSHOT")


if __name__ == "__main__":
    try:
        print(json.dumps(resolve(strict_json(sys.stdin.read())), sort_keys=True))
    except (ValueError, TypeError):
        print(json.dumps(blocked("INVALID_INPUT_JSON")))
