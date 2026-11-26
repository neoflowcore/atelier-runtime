"""Conservative admission check for actual host and classic GitHub protection observations."""
import json
import re
import sys
import time
from resolve_release import blocked, strict_json


def enabled(body, name, value):
    return body.get(name, {}).get("enabled") is value


def evaluate(data, now=None):
    try:
        now = int(time.time()) if now is None else now
        repo, branch, surface = (data[k] for k in ("repository", "branch", "surface_id"))
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not re.fullmatch(r"pilote-CS-[A-Za-z0-9._-]+", branch) or ".." in branch or not isinstance(surface, str) or not surface:
            return blocked("SURFACE_TARGET_INVALID")
        observed = data["observed_at"]
        if type(observed) is not int or not 0 <= now - observed <= 300:
            return blocked("PROTECTION_OBSERVATION_STALE")
        bodies = []
        for key, expected_branch in (("main_protection", "main"), ("development_protection", branch)):
            obs = data[key]
            if obs["repository"] != repo or obs["branch"] != expected_branch or obs["status"] != 200 or obs["source"] != "github.branch_protection":
                return blocked("SERVER_PROTECTION_UNVERIFIED")
            body = obs["body"]
            if not enabled(body, "enforce_admins", True) or not enabled(body, "allow_force_pushes", False) or not enabled(body, "allow_deletions", False):
                return blocked("SERVER_PROTECTION_INSUFFICIENT")
            bodies.append(body)
        main = bodies[0]
        reviews = main["required_pull_request_reviews"]
        bypass = reviews.get("bypass_pull_request_allowances")
        if type(reviews["required_approving_review_count"]) is not int or reviews["required_approving_review_count"] < 1 or not isinstance(bypass, dict) or set(bypass) != {"users", "teams", "apps"} or any(v != [] for v in bypass.values()):
            return blocked("MAIN_REVIEW_OR_BYPASS_UNVERIFIED")
        checks = main["required_status_checks"]
        required = data["required_checks"]
        if not isinstance(required, list) or not required or any(not isinstance(x, str) or not x for x in required) or checks["strict"] is not True or not set(required) <= set(checks["contexts"]):
            return blocked("MAIN_REQUIRED_CHECKS_UNVERIFIED")
        cas = data["cas_receipt"]
        if cas["surface_id"] != surface or cas["kind"] != "REMOTE_SANDBOX" or cas["non_force"] is not True or cas["stale_expected_rejected"] is not True or cas["fresh_expected_applied"] is not True or not isinstance(cas["evidence_id"], str) or not cas["evidence_id"]:
            return blocked("CAS_NOT_QUALIFIED")
        return {"status": "SURFACE_PRECONDITIONS_OBSERVED", "repository": repo, "branch": branch, "surface_id": surface, "observed_at": observed, "write_authority": False, "server_enforcement_proven": False}
    except (KeyError, TypeError, ValueError, AttributeError):
        return blocked("SURFACE_EVIDENCE_INVALID_OR_UNAVAILABLE")


if __name__ == "__main__":
    try:
        result = evaluate(strict_json(sys.stdin.read()))
    except (ValueError, TypeError):
        result = blocked("INVALID_INPUT")
    print(json.dumps(result, sort_keys=True))
