"""Build an unsigned, review-only release registry proposal from verified evidence."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".agents/skills/atelier-dev/scripts"))
from resolve_release import REPO, blocked, digest, hex_id, strict_json, resolve
from mutation_guard import canonical


def prepare(data):
    try:
        candidate = data["candidate"]
        evidence = data["ci_receipt"]
        evidence_body = evidence["evidence"]
        required = data["required_jobs"]
        if evidence.get("status") != "CI_EVIDENCE_VERIFIED" or evidence.get("write_authority") is not False or digest(canonical(evidence_body)) != evidence.get("evidence_sha256") or evidence_body["repository"] != REPO or evidence_body["head"] != candidate["commit"] or not isinstance(required, dict) or not required:
            return blocked("CANDIDATE_CI_EVIDENCE_MISMATCH")
        actual = {j["name"]: set(j["steps"]) for j in evidence_body["jobs"]}
        if any(name not in actual or not isinstance(steps, list) or not steps or not set(steps) <= actual[name] for name, steps in required.items()):
            return blocked("CANDIDATE_REQUIRED_STEPS_MISSING")
        if any(name not in {a["name"] for a in evidence_body["artifacts"]} for name in data["required_artifacts"]):
            return blocked("CANDIDATE_REQUIRED_ARTIFACT_MISSING")
        old_text = data.get("previous_registry_text")
        if old_text is None:
            if data.get("initial_registry") is not True or data.get("previous_registry_state") is not None:
                return blocked("FIRST_REGISTRY_REVIEW_REQUIRED")
            old = {"schema": 1, "repository": REPO, "stable": [], "revoked": [], "generation": 0}
        else:
            old = strict_json(old_text)
            state = data["previous_registry_state"]
            if old["repository"] != REPO or old["schema"] != 1 or state["repository"] != REPO or state["registry_sha256"] != digest(old_text) or state["generation"] != old["generation"]:
                return blocked("PREVIOUS_REGISTRY_UNBOUND")
        generation, issued, expires, floor = (data[k] for k in ("generation", "issued_at", "expires_at", "minimum_generation"))
        if any(type(n) is not int for n in (generation, issued, expires, floor, old["generation"])) or floor < 1 or generation < floor or generation <= old["generation"] or not 0 < issued < expires or expires - issued > 90 * 86400:
            return blocked("REGISTRY_GENERATION_OR_TIME_INVALID")
        if not all(hex_id(candidate[k], 40) for k in ("commit", "tree")):
            return blocked("CANDIDATE_IDENTITY_INVALID")
        manifest_text = candidate["manifest_text"]
        manifest = strict_json(manifest_text)
        release_id = manifest["id"]
        prior_ids = [e["id"] for e in old["stable"]]
        if release_id in prior_ids or release_id in old["revoked"] or any(e["commit"] == candidate["commit"] for e in old["stable"]):
            return blocked("RELEASE_ID_OR_COMMIT_REUSED")
        revoke = data.get("revoke", [])
        if not isinstance(revoke, list) or len(set(revoke)) != len(revoke) or not set(revoke) <= set(prior_ids):
            return blocked("REVOCATION_SCOPE_INVALID")
        entry = {"id": release_id, "sequence": max([e["sequence"] for e in old["stable"]] + [0]) + 1, "commit": candidate["commit"], "tree": candidate["tree"], "manifest_sha256": digest(manifest_text)}
        reg = {"schema": 1, "repository": REPO, "generation": generation, "issued_at": issued, "expires_at": expires, "stable": [entry, *old["stable"]], "revoked": sorted(set(old["revoked"]) | set(revoke))}
        text = json.dumps(reg, indent=2, sort_keys=True) + "\n"
        # Structural verification only. This is not a publisher-trust or promotion verdict.
        probe = resolve({"trusted_registry": True, "registry_head": candidate["commit"], "registry_text": text, "snapshots": {candidate["commit"]: {"tree": candidate["tree"], "manifest_text": manifest_text, "files": candidate["files"]}}, "capabilities": data["capabilities"]})
        if probe["status"] != "BOUND" or probe["release"] != entry:
            return blocked("CANDIDATE_MANIFEST_OR_COMPATIBILITY_INVALID")
        return {"status": "UNSIGNED_REGISTRY_DRAFT", "registry_text": text, "registry_sha256": digest(text), "candidate": entry, "ci_evidence_sha256": evidence["evidence_sha256"], "signature_required": True, "human_promotion_required": True, "write_authority": False}
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return blocked("RELEASE_DRAFT_INPUT_INVALID")


if __name__ == "__main__":
    try:
        result = prepare(strict_json(sys.stdin.read()))
    except (ValueError, TypeError, AttributeError):
        result = blocked("INVALID_INPUT")
    print(json.dumps(result, sort_keys=True))
