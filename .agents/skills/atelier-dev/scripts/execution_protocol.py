"""Deterministic GitHub connector handoff; emits requests, never executes writes."""
import hashlib
import json
import sys
from resolve_release import blocked, hex_id, safe_path, strict_json, digest
from mutation_guard import canonical, compile_proposal
from surface_policy import evaluate


def object_sha(kind, raw):
    return hashlib.sha1(kind.encode() + b" " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def flatten_tree(tree, expected):
    """Reconstruct all tree objects from a complete recursive GitHub response."""
    if tree.get("truncated") is not False or tree.get("sha") != expected or not hex_id(expected, 40):
        raise ValueError("TREE_INCOMPLETE_OR_WRONG_ROOT")
    entries, directories = {}, {"": []}
    modes = {"040000": "tree", "100644": "blob", "100755": "blob", "120000": "blob", "160000": "commit"}
    for e in tree["tree"]:
        path, mode, sha = e["path"], e["mode"], e["sha"]
        if not safe_path(path) or any(ord(c) < 32 for c in path) or path in entries or mode not in modes or modes[mode] != e["type"] or not hex_id(sha, 40):
            raise ValueError("TREE_ENTRY_INVALID")
        entries[path] = (mode, sha)
        if mode == "040000":
            directories[path] = []
    for path, (mode, sha) in entries.items():
        parent, _, name = path.rpartition("/")
        if parent not in directories:
            raise ValueError("TREE_PARENT_MISSING")
        raw_name = name.encode("utf-8")
        directories[parent].append((raw_name + (b"/" if mode == "040000" else b""), mode.lstrip("0").encode() + b" " + raw_name + b"\0" + bytes.fromhex(sha)))
    for path, children in directories.items():
        if path and not children:
            raise ValueError("EMPTY_SUBTREE_DENIED")
        calculated = object_sha("tree", b"".join(v for _, v in sorted(children)))
        if calculated != (entries[path][1] if path else expected):
            raise ValueError("TREE_HASH_MISMATCH")
    return {p: v for p, v in entries.items() if v[0] != "040000"}


def output(stage, proposal, handoff_sha, tool=None, args=None, **fields):
    return {"status": "ADVISORY_HANDOFF", "stage": stage, "proposal_sha256": proposal["proposal_sha256"], "handoff_sha256": handoff_sha, "request": {"tool": tool, "arguments": args} if tool else None, "write_authority": False, **fields}


def runtime_binding(data, proposal):
    decision, bound = data["control_decision"], data["bound_release"]
    p, identity = proposal["proposal"], decision["identity"]
    pairs = {"projectIdentityDigest": "project_sha256", "authoritativePlanSetDigest": "plan_sha256", "repository": "repository", "branch": "branch", "head": "base_head", "tree": "base_tree"}
    release = decision["release"]
    if decision.get("status") != "ADVISORY_DECISION" or decision.get("writeAuthority") is not False or decision.get("remoteMutationCount") != 0 or not hex_id(decision.get("runtimeInterfaceDigest"), 64) or any(identity[k] != p[v] for k, v in pairs.items()) or not isinstance(release["id"], str) or not hex_id(release["commit"], 40) or not hex_id(release["manifest_sha256"], 64):
        raise ValueError("RUNTIME_BINDING_INVALID")
    if bound.get("status") != "BOUND" or bound.get("publisher_verified") is not True or bound.get("write_authority") is not False or not {"runtime.control", "source.handoff"} <= set(bound["enabled_features"]) or any(release[k] != bound["release"][k] for k in ("id", "commit", "manifest_sha256")):
        raise ValueError("RELEASE_BINDING_MISMATCH")
    if decision["authority"].get("reusable") is not True or decision["response"].get("continueExecution") is not True or decision["next"].get("decision") != "CONTINUE_CREDENTIAL_INDEPENDENT_WORK" or decision["next"]["ACTIVE_NEXT"]["id"] != data["action_id"] or decision["next"]["ACTIVE_NEXT"]["kind"] not in {"SOURCE", "CODE", "TEST", "DOCS", "CONFIG", "SPEC"}:
        raise ValueError("RUNTIME_ACTION_NOT_ELIGIBLE")
    return digest(canonical({"proposal_sha256": proposal["proposal_sha256"], "control_decision": decision, "release": release, "action_id": data["action_id"]}))


def step(data, now=None):
    """Use fresh observations and a real grant at each stage, not a prior response as authority."""
    try:
        stage = data["stage"]
        original = data["original"]
        proposal = compile_proposal(original, now)
        if proposal["status"] != "ADVISORY_PROPOSAL":
            return proposal
        p = proposal["proposal"]
        if stage != "prepare" and data.get("proposal_sha256") != proposal["proposal_sha256"]:
            return blocked("PROPOSAL_DRIFT")
        handoff_sha = runtime_binding(data, proposal)
        if stage != "prepare" and data.get("handoff_sha256") != handoff_sha:
            return blocked("RUNTIME_HANDOFF_DRIFT")
        repo, branch = p["repository"], p["branch"]
        if stage != "ref_readback":
            surface = evaluate(data["surface_evidence"], now)
            if surface["status"] != "SURFACE_PRECONDITIONS_OBSERVED":
                return surface
            if surface["repository"] != repo or surface["branch"] != branch:
                return blocked("SURFACE_TARGET_MISMATCH")
        fresh = data["fresh_branch"]
        if fresh["repository"] != repo or fresh["branch"] != branch:
            return blocked("BRANCH_IDENTITY_MISMATCH")
        base = flatten_tree(data["base_tree"], p["base_tree"])
        for path, sha in p["files"].items():
            if path.startswith((".github/", ".atelier/releases/registry.")) or (path in base and base[path][0] != "100644") or base.get(path) == ("100644", sha):
                return blocked("UNSAFE_OR_NOOP_FILE")
            if any(path.startswith(x + "/") or x.startswith(path + "/") for x in set(base) | set(p["files"]) if x != path):
                return blocked("FILE_DIRECTORY_COLLISION")
        if stage == "prepare":
            if fresh["head"] != p["base_head"] or fresh["tree"] != p["base_tree"]:
                return blocked("REMOTE_DRIFT")
            return output("CREATE_TREE", proposal, handoff_sha, "create_tree", {"repository_full_name": repo, "base_tree_sha": p["base_tree"], "tree_elements": [{"path": f["path"], "mode": "100644", "type": "blob", "content": f["content"]} for f in original["changes"]]})
        candidate_tree = data["candidate_tree"]
        tree_sha = candidate_tree["sha"]
        actual = flatten_tree(candidate_tree, tree_sha)
        expected = {**base, **{path: ("100644", sha) for path, sha in p["files"].items()}}
        if actual != expected:
            return blocked("CANDIDATE_TREE_DELTA_MISMATCH")
        if stage == "tree_readback":
            if fresh["head"] != p["base_head"] or fresh["tree"] != p["base_tree"]:
                return blocked("REMOTE_DRIFT")
            message = data["message"]
            if not isinstance(message, str) or not message.strip() or len(message) > 1000:
                return blocked("COMMIT_MESSAGE_INVALID")
            return output("CREATE_COMMIT", proposal, handoff_sha, "create_commit", {"repository_full_name": repo, "message": message, "tree_sha": tree_sha, "parent_sha": p["base_head"]})
        commit = data["candidate_commit"]
        head = commit["sha"]
        if not hex_id(head, 40) or commit["tree"]["sha"] != tree_sha or [x["sha"] for x in commit["parents"]] != [p["base_head"]]:
            return blocked("CANDIDATE_COMMIT_MISMATCH")
        if stage == "commit_readback":
            if fresh["head"] != p["base_head"] or fresh["tree"] != p["base_tree"]:
                return blocked("REMOTE_DRIFT")
            if data.get("cas_capability") != "WRITE_VERIFIED":
                return blocked("CAS_NOT_QUALIFIED")
            return output("UPDATE_REF", proposal, handoff_sha, "update_ref", {"repository_full_name": repo, "branch_name": branch, "sha": head, "expected_sha": p["base_head"], "force": False})
        if stage == "ref_readback":
            if fresh["head"] == head and fresh["tree"] == tree_sha:
                return {"status": "REMOTE_EFFECT_VERIFIED", "repository": repo, "branch": branch, "base_head": p["base_head"], "head": head, "tree": tree_sha, "proposal_sha256": proposal["proposal_sha256"], "handoff_sha256": handoff_sha, "write_authority": False}
            if fresh["head"] == p["base_head"] and fresh["tree"] == p["base_tree"]:
                return blocked("BASE_OBSERVED_RECOMPILE_REQUIRED")
            return blocked("OUTCOME_UNKNOWN_RECONCILE_REQUIRED")
        return blocked("STAGE_INVALID")
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return blocked("INVALID_EXECUTION_OBSERVATION")


def reconcile_only(data):
    """Reconcile after an expired grant without requesting or repeating any write."""
    try:
        p = data["proposal"]
        sha = data["proposal_sha256"]
        if not hex_id(sha, 64) or digest(canonical(p)) != sha or not hex_id(data["handoff_sha256"], 64):
            return blocked("PROPOSAL_OR_HANDOFF_INVALID")
        if not hex_id(p["base_head"], 40) or not hex_id(p["base_tree"], 40) or not isinstance(p["files"], dict) or not p["files"] or any(not safe_path(path) or not hex_id(h, 40) for path, h in p["files"].items()):
            return blocked("PROPOSAL_INVALID")
        base = flatten_tree(data["base_tree"], p["base_tree"])
        tree = data["candidate_tree"]
        if flatten_tree(tree, tree["sha"]) != {**base, **{path: ("100644", h) for path, h in p["files"].items()}}:
            return blocked("CANDIDATE_TREE_DELTA_MISMATCH")
        commit = data["candidate_commit"]
        if not hex_id(commit["sha"], 40) or commit["tree"]["sha"] != tree["sha"] or [x["sha"] for x in commit["parents"]] != [p["base_head"]]:
            return blocked("CANDIDATE_COMMIT_MISMATCH")
        fresh = data["fresh_branch"]
        if fresh["repository"] != p["repository"] or fresh["branch"] != p["branch"]:
            return blocked("BRANCH_IDENTITY_MISMATCH")
        if fresh["head"] == commit["sha"] and fresh["tree"] == tree["sha"]:
            return {"status": "REMOTE_EFFECT_VERIFIED", "repository": p["repository"], "branch": p["branch"], "base_head": p["base_head"], "head": fresh["head"], "tree": fresh["tree"], "proposal_sha256": sha, "handoff_sha256": data["handoff_sha256"], "write_authority": False}
        if fresh["head"] == p["base_head"] and fresh["tree"] == p["base_tree"]:
            return blocked("BASE_OBSERVED_RECOMPILE_REQUIRED")
        return blocked("OUTCOME_UNKNOWN_RECONCILE_REQUIRED")
    except (KeyError, TypeError, ValueError, AttributeError):
        return blocked("INVALID_RECONCILIATION_OBSERVATION")


if __name__ == "__main__":
    try:
        data = strict_json(sys.stdin.read())
        result = reconcile_only(data) if data.get("mode") == "reconcile_only" else step(data)
    except (ValueError, TypeError, AttributeError):
        result = blocked("INVALID_INPUT")
    print(json.dumps(result, sort_keys=True))
