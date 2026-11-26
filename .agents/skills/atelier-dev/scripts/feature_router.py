"""Select a manifest-bound compatible handler; do not load or execute remote code."""
import json
import sys
from resolve_release import REPO, blocked, digest, hex_id, safe_path, strict_json

HANDLERS = {"knowledge.read": ["github.read"], "source.proposal": ["github.read", "script.execute"], "source.handoff": ["github.read", "github.write.cas", "script.execute", "runtime.execute"], "runtime.control": ["github.read", "runtime.execute"], "ci.evidence": ["github.read", "script.execute"], "release.draft": ["github.read", "script.execute"]}


def route(data):
    try:
        selected, text, name = data["selection"], data["manifest_text"], data["feature_id"]
        if selected["status"] != "BOUND" or selected["publisher_verified"] is not True or selected["write_authority"] is not False or name not in selected["enabled_features"]:
            return blocked("FEATURE_NOT_BOUND_OR_ENABLED")
        release = selected["release"]
        if not hex_id(release["commit"], 40) or digest(text) != release["manifest_sha256"]:
            return blocked("FEATURE_MANIFEST_MISMATCH")
        manifest = strict_json(text)
        if manifest["schema"] != 1 or manifest["repository"] != REPO or manifest["id"] != release["id"]:
            return blocked("FEATURE_MANIFEST_IDENTITY_INVALID")
        matches = [f for f in manifest["features"] if f["id"] == name]
        if len(matches) != 1:
            return blocked("FEATURE_NOT_UNIQUE")
        feature = matches[0]
        handler = feature.get("handler")
        if handler not in HANDLERS:
            return blocked("FEATURE_HANDLER_UNSUPPORTED")
        declared = set(feature["required_capabilities"])
        if not set(HANDLERS[handler]) <= declared or not declared <= set(data["capabilities"]):
            return blocked("FEATURE_CAPABILITY_MISMATCH")
        paths = feature["paths"]
        if not isinstance(paths, list) or not paths or len(set(paths)) != len(paths):
            return blocked("FEATURE_PATHS_INVALID")
        files = []
        for path in paths:
            matches = [f for f in manifest["files"] if f["path"] == path]
            if not safe_path(path) or len(matches) != 1 or digest(data["files"][path]) != matches[0]["sha256"]:
                return blocked("FEATURE_FILE_INTEGRITY_FAILURE")
            files.append(matches[0])
        return {"status": "FEATURE_ROUTE_SELECTED", "feature_id": name, "handler": handler, "release": release, "files": files, "write_authority": False, "execution_performed": False}
    except (KeyError, TypeError, ValueError, AttributeError):
        return blocked("FEATURE_ROUTE_INPUT_INVALID")


if __name__ == "__main__":
    try:
        result = route(strict_json(sys.stdin.read()))
    except (ValueError, TypeError):
        result = blocked("INVALID_INPUT")
    print(json.dumps(result, sort_keys=True))
