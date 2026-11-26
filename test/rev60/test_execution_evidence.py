import base64
import hashlib
import io
import sys
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".agents/skills/atelier-dev/scripts"))
from execution_protocol import object_sha, flatten_tree, step, runtime_binding
from ci_evidence import verify
from mutation_guard import blob, compile_proposal


def tree(files):
    directories = {"": []}
    entries = []
    for path, content in files.items():
        directory, _, name = path.rpartition("/")
        sha = blob(content)
        directories.setdefault(directory, []).append((name, "100644", sha))
        entries.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
        while directory:
            directory = directory.rpartition("/")[0]
            directories.setdefault(directory, [])
    for path in sorted(directories, key=lambda p: (p.count("/"), len(p)), reverse=True):
        raw = b"".join(mode.lstrip("0").encode() + b" " + name.encode() + b"\0" + bytes.fromhex(sha) for name, mode, sha in sorted(directories[path], key=lambda x: x[0] + ("/" if x[1] == "040000" else "")))
        sha = object_sha("tree", raw)
        if not path:
            return {"sha": sha, "truncated": False, "tree": entries}
        parent, _, name = path.rpartition("/")
        directories[parent].append((name, "040000", sha))
        entries.append({"path": path, "mode": "040000", "type": "tree", "sha": sha})


def fixture():
    b = tree({"src/old.txt": "old", "README.md": "base"})
    c = tree({"src/old.txt": "old", "README.md": "base", "src/new.txt": "new"})
    ctx = {"project_sha256": "a" * 64, "plan_sha256": "b" * 64, "repository": "neoflowcore/target", "branch": "pilote-CS-test", "head": "c" * 40, "tree": b["sha"]}
    original = {"context": ctx, "grant": {**ctx, "scope": "NON_DESTRUCTIVE_SOURCE_DEVELOPMENT", "expires_at": 200, "allowed_prefixes": ["src"]}, "observation": ctx, "operation": "source.commit", "force": False, "destructive": False, "changes": [{"path": "src/new.txt", "mode": "100644", "content": "new"}]}
    proposal = compile_proposal(original, 150)
    release = {"id": "6.0.0", "commit": "e" * 40, "manifest_sha256": "e" * 64}
    identity = {"projectIdentityDigest": ctx["project_sha256"], "authoritativePlanSetDigest": ctx["plan_sha256"], **{k: ctx[k] for k in ("repository", "branch", "head", "tree")}}
    decision = {"status": "ADVISORY_DECISION", "identity": identity, "release": release, "writeAuthority": False, "remoteMutationCount": 0, "runtimeInterfaceDigest": "a" * 64, "next": {"decision": "CONTINUE_CREDENTIAL_INDEPENDENT_WORK", "ACTIVE_NEXT": {"id": "implement", "kind": "CODE"}}, "response": {"continueExecution": True}, "authority": {"reusable": True}}
    data = {"stage": "prepare", "proposal_sha256": proposal["proposal_sha256"], "original": original, "fresh_branch": dict(ctx), "base_tree": b, "candidate_tree": c, "message": "feat: add file", "candidate_commit": {"sha": "d" * 40, "tree": {"sha": c["sha"]}, "parents": [{"sha": ctx["head"]}]}, "cas_capability": "WRITE_VERIFIED", "control_decision": decision, "bound_release": {"status": "BOUND", "publisher_verified": True, "write_authority": False, "release": release}, "action_id": "implement"}
    data["handoff_sha256"] = runtime_binding(data, proposal)
    return data


class ExecutionTests(unittest.TestCase):
    def test_full_handoff_no_authority(self):
        d = fixture()
        r = step(d, now=150)
        self.assertEqual(r["request"]["tool"], "create_tree")
        d["proposal_sha256"] = r["proposal_sha256"]
        d["stage"] = "tree_readback"
        self.assertEqual(step(d, now=150)["request"]["tool"], "create_commit")
        d["stage"] = "commit_readback"
        r = step(d, now=150)
        self.assertEqual(r["request"]["arguments"]["expected_sha"], "c" * 40)
        self.assertFalse(r["request"]["arguments"]["force"])
        self.assertFalse(r["write_authority"])
        d["stage"] = "ref_readback"
        d["fresh_branch"].update(head="d" * 40, tree=d["candidate_tree"]["sha"])
        self.assertEqual(step(d, now=150)["status"], "REMOTE_EFFECT_VERIFIED")

    def test_git_tree_identity(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            subprocess.run(["git", "init", "-q", td], check=True)
            files = {"a/b.txt": "b", "a/x/y.txt": "y", "a.txt": "a"}
            for path, content in files.items():
                target = root / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text(content)
            subprocess.run(["git", "-C", td, "add", "."], check=True)
            actual = subprocess.check_output(["git", "-C", td, "write-tree"]).decode().strip()
            t = tree(files)
            self.assertEqual(t["sha"], actual)
            self.assertEqual(len(flatten_tree(t, actual)), 3)

    def test_runtime_binding_drift(self):
        d = fixture(); d["stage"] = "tree_readback"; d["control_decision"]["runtimeInterfaceDigest"] = "b" * 64
        self.assertEqual(step(d, now=150)["reason"], "RUNTIME_HANDOFF_DRIFT")
        d = fixture(); d["control_decision"]["authority"]["reusable"] = False
        self.assertEqual(step(d, now=150)["status"], "BLOCKED")

    def test_proposal_drift(self):
        d = fixture(); d["stage"] = "tree_readback"; del d["proposal_sha256"]
        self.assertEqual(step(d, now=150)["reason"], "PROPOSAL_DRIFT")

    def test_tree_hash_and_truncation(self):
        d = fixture(); t = d["base_tree"]
        self.assertEqual(len(flatten_tree(t, t["sha"])), 2)
        t["tree"][0]["sha"] = "f" * 40
        self.assertEqual(step(d, now=150)["status"], "BLOCKED")
        d = fixture(); d["base_tree"]["truncated"] = True
        self.assertEqual(step(d, now=150)["status"], "BLOCKED")

    def test_extra_or_missing_candidate_file(self):
        d = fixture(); d["stage"] = "tree_readback"
        d["candidate_tree"] = tree({"src/old.txt": "old", "README.md": "changed", "src/new.txt": "new"})
        self.assertEqual(step(d, now=150)["reason"], "CANDIDATE_TREE_DELTA_MISMATCH")

    def test_cas_and_drift(self):
        d = fixture(); d["stage"] = "commit_readback"; d["cas_capability"] = "DISCOVERED"
        self.assertEqual(step(d, now=150)["reason"], "CAS_NOT_QUALIFIED")
        d["cas_capability"] = "WRITE_VERIFIED"; d["fresh_branch"]["head"] = "0" * 40
        self.assertEqual(step(d, now=150)["reason"], "REMOTE_DRIFT")

    def test_noop_and_collision(self):
        d = fixture(); d["original"]["changes"] = [{"path": "src/old.txt", "mode": "100644", "content": "old"}]
        self.assertEqual(step(d, now=150)["reason"], "UNSAFE_OR_NOOP_FILE")
        d["original"]["changes"][0]["path"] = "src/old.txt/child"
        self.assertEqual(step(d, now=150)["reason"], "FILE_DIRECTORY_COLLISION")

    def test_wrong_parent_and_unknown_effect(self):
        d = fixture(); d["stage"] = "commit_readback"; d["candidate_commit"]["parents"] = [{"sha": "0" * 40}]
        self.assertEqual(step(d, now=150)["reason"], "CANDIDATE_COMMIT_MISMATCH")
        d = fixture(); d["stage"] = "ref_readback"
        self.assertEqual(step(d, now=150)["reason"], "BASE_OBSERVED_RECOMPILE_REQUIRED")
        d["fresh_branch"]["head"] = "0" * 40
        self.assertEqual(step(d, now=150)["reason"], "OUTCOME_UNKNOWN_RECONCILE_REQUIRED")


def evidence(member="receipt.json"):
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w") as z:
        z.writestr(member, '{"fixture": true}')
    content = raw.getvalue()
    head = "a" * 40
    repo = "neoflowcore/target"
    success = {"status": "completed", "conclusion": "success"}
    return {"expected": {"repository": repo, "head": head, "run_id": 1, "workflow_id": 2, "attempt": 1, "required_jobs": {"verify": ["test"]}, "required_artifacts": ["run-1-attempt-1-evidence"]}, "run": {**success, "repository": {"full_name": repo}, "head_sha": head, "id": 1, "workflow_id": 2, "run_attempt": 1}, "jobs": {"total_count": 1, "jobs": [{**success, "name": "verify", "id": 3, "run_id": 1, "run_attempt": 1, "head_sha": head, "steps": [{**success, "name": "test"}]}]}, "artifacts": {"total_count": 1, "artifacts": [{"id": 4, "name": "run-1-attempt-1-evidence", "expired": False, "digest": "sha256:" + hashlib.sha256(content).hexdigest(), "workflow_run": {"id": 1, "head_sha": head}}]}, "archives": {"4": base64.b64encode(content).decode()}}


class EvidenceTests(unittest.TestCase):
    def test_exact_evidence_bytes(self):
        r = verify(evidence())
        self.assertEqual(r["status"], "CI_EVIDENCE_VERIFIED")
        self.assertEqual(r["evidence"]["artifact_status"], "BYTES_VERIFIED")
        self.assertFalse(r["write_authority"])

    def test_run_and_attempt_mismatch(self):
        d = evidence(); d["run"]["head_sha"] = "b" * 40
        self.assertEqual(verify(d)["reason"], "CI_RUN_MISMATCH_OR_NOT_SUCCESS")
        d = evidence(); d["jobs"]["jobs"][0]["run_attempt"] = 2
        self.assertEqual(verify(d)["reason"], "CI_JOB_MISMATCH_OR_NOT_SUCCESS")

    def test_incomplete_or_skipped_step(self):
        d = evidence(); d["jobs"]["total_count"] = 2
        self.assertEqual(verify(d)["reason"], "CI_JOB_SET_INCOMPLETE")
        d = evidence(); d["jobs"]["jobs"][0]["steps"][0]["conclusion"] = "skipped"
        self.assertEqual(verify(d)["reason"], "REQUIRED_CI_STEP_NOT_SUCCESS")

    def test_tampered_expired_and_traversal(self):
        d = evidence(); d["archives"]["4"] = "YWJj"
        self.assertEqual(verify(d)["status"], "BLOCKED")
        d = evidence(); d["artifacts"]["artifacts"][0]["expired"] = True
        self.assertEqual(verify(d)["reason"], "ARTIFACT_EXPIRED_OR_WRONG_SUBJECT")
        self.assertEqual(verify(evidence("../escape"))["status"], "BLOCKED")

    def test_artifact_attempt_required(self):
        d = evidence(); d["expected"]["required_artifacts"] = ["legacy"]; d["artifacts"]["artifacts"][0]["name"] = "legacy"
        self.assertEqual(verify(d)["reason"], "ARTIFACT_ATTEMPT_NOT_BOUND")

    def test_no_required_artifact_distinct(self):
        d = evidence(); d["expected"]["required_artifacts"] = []; d["artifacts"] = {"total_count": 0, "artifacts": []}; d["archives"] = {}
        self.assertEqual(verify(d)["evidence"]["artifact_status"], "NOT_REQUIRED")


if __name__ == "__main__":
    unittest.main()
