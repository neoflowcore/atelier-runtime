"""Compile and reconcile advisory GitHub change proposals without network access."""
import hashlib
import json
import re
import sys
import time
from resolve_release import blocked, digest, hex_id, safe_path, strict_json


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def blob(text):
    b = text.encode("utf-8")
    return hashlib.sha1(b"blob " + str(len(b)).encode() + b"\0" + b).hexdigest()


def compile_proposal(data, now=None):
    try:
        now = int(time.time()) if now is None else now
        ctx, grant, remote, changes = (data[k] for k in ("context", "grant", "observation", "changes"))
        binding = ("project_sha256", "plan_sha256", "repository", "branch")
        if any(ctx[k] != grant[k] for k in binding) or not all(hex_id(ctx[k], 64) for k in binding[:2]) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", ctx["repository"]) or not re.fullmatch(r"pilote-CS-[A-Za-z0-9._-]+", ctx["branch"]) or ".." in ctx["branch"] or grant.get("scope") != "NON_DESTRUCTIVE_SOURCE_DEVELOPMENT" or type(grant["expires_at"]) is not int or grant["expires_at"] <= now:
            return blocked("GRANT_SCOPE_OR_EXPIRY_MISMATCH")
        if any(remote[k] != ctx[k] for k in ("repository", "branch", "head", "tree")) or not all(hex_id(ctx[k], 40) for k in ("head", "tree")):
            return blocked("REMOTE_DRIFT")
        if data.get("operation") != "source.commit" or data.get("force") is not False or data.get("destructive") is not False:
            return blocked("OPERATION_DENIED")
        prefixes = grant["allowed_prefixes"]
        if not isinstance(prefixes, list) or not prefixes or any(not safe_path(p.rstrip("/")) for p in prefixes) or not isinstance(changes, list) or not changes or len(changes) > 128:
            return blocked("CHANGE_SCOPE_INVALID")
        files = {}
        total = 0
        for f in changes:
            path, content = f["path"], f["content"]
            if not safe_path(path) or path in files or not isinstance(content, str) or f.get("mode") != "100644" or any(x in {".git", ".env", "secrets"} or x.startswith(".env.") for x in path.split("/")) or path.startswith(".atelier/releases/registry.") or not any(path == p.rstrip("/") or path.startswith(p.rstrip("/") + "/") for p in prefixes):
                return blocked("PATH_OR_FILE_DENIED")
            total += len(content.encode("utf-8"))
            if total > 4 * 1024 * 1024:
                return blocked("CHANGE_LIMIT_EXCEEDED")
            files[path] = blob(content)
        body = {**{k: ctx[k] for k in binding}, "base_head": ctx["head"], "base_tree": ctx["tree"], "files": files}
        return {"status": "ADVISORY_PROPOSAL", "proposal": body, "proposal_sha256": digest(canonical(body)), "write_authority": False}
    except (KeyError, TypeError, ValueError, AttributeError):
        return blocked("INVALID_CHANGE_INPUT")


def reconcile(data):
    try:
        p, remote, candidate = (data[k] for k in ("proposal", "observation", "candidate"))
        if digest(canonical(p)) != data["proposal_sha256"] or remote["repository"] != p["repository"] or remote["branch"] != p["branch"]:
            return blocked("PROPOSAL_OR_TARGET_MISMATCH")
        if remote["head"] == p["base_head"] and remote["tree"] == p["base_tree"]:
            return {"status": "BASE_OBSERVED_RECOMPILE_REQUIRED", "write_authority": False}
        if not all(hex_id(candidate[k], 40) for k in ("head", "tree")) or remote["head"] != candidate["head"] or remote["tree"] != candidate["tree"] or candidate["parents"] != [p["base_head"]] or candidate["files"] != p["files"]:
            return blocked("OUTCOME_UNKNOWN_RECONCILE_REQUIRED")
        return {"status": "REMOTE_EFFECT_VERIFIED", "repository": p["repository"], "branch": p["branch"], "base_head": p["base_head"], "head": remote["head"], "tree": remote["tree"], "proposal_sha256": data["proposal_sha256"], "write_authority": False}
    except (KeyError, TypeError, ValueError, AttributeError):
        return blocked("INVALID_READBACK")


if __name__ == "__main__":
    try:
        d = strict_json(sys.stdin.read())
        r = reconcile(d) if d.get("mode") == "reconcile" else compile_proposal(d)
    except (ValueError, TypeError, AttributeError):
        r = blocked("INVALID_INPUT")
    print(json.dumps(r, sort_keys=True))
