"""Build an unsigned release manifest from explicitly selected checkout files."""
import argparse
import hashlib
import json
import re
from pathlib import Path

REPO = "neoflowcore/atelier-runtime"
KINDS = {"policy", "knowledge", "contract", "adapter", "feature"}


def unique_strings(values):
    return isinstance(values, list) and all(isinstance(v, str) and v for v in values) and len(values) == len(set(values))


def prepare(root, spec):
    root = Path(root).resolve(strict=True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", spec["id"]):
        raise ValueError("INVALID_RELEASE_ID")
    lo, hi = spec["protocol_min"], spec["protocol_max"]
    if type(lo) is not int or type(hi) is not int or not 1 <= lo <= hi or not unique_strings(spec["required_capabilities"]):
        raise ValueError("INVALID_COMPATIBILITY")
    paths, files = set(), []
    for entry in spec["files"]:
        name = entry["path"]
        if not isinstance(name, str) or "\\" in name or any(x in {"", ".", "..", ".git"} for x in name.split("/")) or name in paths or entry["kind"] not in KINDS:
            raise ValueError("INVALID_MODULE_PATH")
        path = root / name
        if any(p.is_symlink() for p in [path, *path.parents] if p != root and root in p.parents) or not path.is_file() or not path.resolve().is_relative_to(root):
            raise ValueError("MODULE_NOT_REGULAR_FILE")
        raw = path.read_bytes()
        raw.decode("utf-8", errors="strict")
        files.append({"path": name, "kind": entry["kind"], "sha256": hashlib.sha256(raw).hexdigest()})
        paths.add(name)
    features, seen = [], set()
    for feature in spec["features"]:
        name = feature["id"]
        if not isinstance(name, str) or not name or name in seen or not unique_strings(feature["paths"]) or not set(feature["paths"]) <= paths or not unique_strings(feature["required_capabilities"]):
            raise ValueError("INVALID_FEATURE")
        result = {k: feature[k] for k in ("id", "paths", "required_capabilities")}
        if "handler" in feature:
            if not isinstance(feature["handler"], str) or not feature["handler"]:
                raise ValueError("INVALID_FEATURE_HANDLER")
            result["handler"] = feature["handler"]
        features.append(result)
        seen.add(name)
    if not files or not features:
        raise ValueError("EMPTY_RELEASE")
    return {"schema": 1, "repository": REPO, "id": spec["id"], "protocol_min": lo, "protocol_max": hi, "required_capabilities": spec["required_capabilities"], "files": sorted(files, key=lambda f: f["path"]), "features": sorted(features, key=lambda f: f["id"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("spec")
    args = parser.parse_args()
    print(json.dumps(prepare(args.root, json.loads(Path(args.spec).read_text(encoding="utf-8"))), indent=2, sort_keys=True))
