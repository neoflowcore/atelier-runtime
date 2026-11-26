"""Collect immutable GitHub release data via a GET-only transport; no write authority."""
import base64
import hashlib
import json
import os
import sys
from urllib.parse import quote
from urllib.request import Request, HTTPRedirectHandler, build_opener
from resolve_release import REPO, blocked, digest, hex_id, safe_path, strict_json
from verify_registry import verify

PREFIX = "/repos/" + REPO
MAX_BYTES = 16 * 1024 * 1024


def blob_id(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def collect(get, trust, capabilities, previous=None, checkpoint=None, now=None):
    """get(path) must be a trusted GET transport for api.github.com."""
    try:
        budget = MAX_BYTES
        def commit_tree(commit):
            if not hex_id(commit, 40):
                raise ValueError("COMMIT_INVALID")
            obj = get(PREFIX + "/git/commits/" + commit)
            tree = obj["tree"]["sha"]
            if obj["sha"] != commit or not hex_id(tree, 40):
                raise ValueError("COMMIT_TREE_MISMATCH")
            result = get(PREFIX + "/git/trees/" + tree + "?recursive=1")
            if result["sha"] != tree or result.get("truncated") is not False:
                raise ValueError("TREE_UNVERIFIED")
            entries = {e["path"]: e for e in result["tree"]}
            if len(entries) != len(result["tree"]):
                raise ValueError("TREE_DUPLICATE_PATH")
            return tree, entries

        def read(commit, entries, path):
            nonlocal budget
            if not safe_path(path):
                raise ValueError("FILE_PATH_INVALID")
            e = entries[path]
            if e["type"] != "blob" or e["mode"] not in {"100644", "100755"}:
                raise ValueError("FILE_NOT_REGULAR")
            r = get(PREFIX + "/contents/" + quote(path, safe="/") + "?ref=" + commit)
            if r["type"] != "file" or r["encoding"] != "base64" or r["sha"] != e["sha"]:
                raise ValueError("BLOB_IDENTITY_MISMATCH")
            raw = base64.b64decode("".join(r["content"].split()), validate=True)
            budget -= len(raw)
            if budget < 0 or blob_id(raw) != e["sha"]:
                raise ValueError("BLOB_INTEGRITY_OR_BUDGET")
            return raw.decode("utf-8", errors="strict")

        head = get(PREFIX + "/branches/main")["commit"]["sha"]
        _, entries = commit_tree(head)
        data = {"registry_head": head, "registry_text": read(head, entries, ".atelier/releases/registry.v1.json"), "registry_signature": read(head, entries, ".atelier/releases/registry.v1.sig").strip(), "snapshots": {}, "capabilities": capabilities}
        if checkpoint is not None:
            data["checkpoint"] = checkpoint
        probe = verify(data, trust, previous, now)
        if probe.get("publisher_verified") is not True:
            return probe
        if probe["reason"] not in {"RELEASE_IDENTITY_UNVERIFIED", "NO_STABLE_RELEASE", "CHECKPOINT_RELEASE_UNAVAILABLE"}:
            return probe
        registry = strict_json(data["registry_text"])
        candidates = registry["stable"]
        if len(candidates) > 32:
            return blocked("RELEASE_LIMIT_EXCEEDED")
        for e in candidates:
            if e["id"] in registry["revoked"] or (checkpoint is not None and any(e[k] != checkpoint[k] for k in ("id", "commit", "manifest_sha256"))):
                continue
            commit = e["commit"]
            tree, entries = commit_tree(commit)
            if tree != e["tree"]:
                return blocked("RELEASE_IDENTITY_UNVERIFIED")
            manifest = read(commit, entries, ".atelier/releases/manifest.v1.json")
            if digest(manifest) != e["manifest_sha256"]:
                return blocked("MANIFEST_INTEGRITY_FAILURE")
            m = strict_json(manifest)
            if len(m["files"]) > 128:
                return blocked("MODULE_LIMIT_EXCEEDED")
            data["snapshots"][commit] = {"tree": tree, "manifest_text": manifest, "files": {f["path"]: read(commit, entries, f["path"]) for f in m["files"]}}
            result = verify(data, trust, previous, now)
            if result["status"] == "BOUND" or result["reason"] != "RELEASE_IDENTITY_UNVERIFIED":
                break
        if get(PREFIX + "/branches/main")["commit"]["sha"] != head:
            return blocked("REGISTRY_HEAD_CHANGED_RETRY_READ")
        return {"status": "SNAPSHOT_COLLECTED", "snapshot": data, "write_authority": False}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return blocked("GITHUB_READ_OR_SNAPSHOT_UNAVAILABLE")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def rest_get(path):
    if not path.startswith(PREFIX + "/") or "\r" in path or "\n" in path:
        raise ValueError("API_PATH_DENIED")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "atelier-skill-read"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    with build_opener(NoRedirect()).open(Request("https://api.github.com" + path, headers=headers, method="GET"), timeout=15) as r:
        raw = r.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("API_RESPONSE_TOO_LARGE")
        return strict_json(raw.decode())


if __name__ == "__main__":
    try:
        d = strict_json(sys.stdin.read())
        r = collect(rest_get, d["trust"], d["capabilities"], d.get("previous"), d.get("checkpoint"))
    except (ValueError, KeyError, TypeError):
        r = blocked("INVALID_INPUT")
    print(json.dumps(r, sort_keys=True))
