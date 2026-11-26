"""Verify exact CI subject and required artifact bytes; no artifact extraction or authority."""
import base64
import hashlib
import io
import json
import re
import stat
import sys
import zipfile
from resolve_release import blocked, hex_id, safe_path, strict_json, digest
from mutation_guard import canonical

LIMIT = 16 * 1024 * 1024


def passed(obj):
    return obj.get("status") == "completed" and obj.get("conclusion") == "success"


def positive(value):
    return type(value) is int and value > 0


def inspect_archive(encoded, expected):
    if not isinstance(encoded, str) or len(encoded) > 4 * ((LIMIT + 2) // 3):
        raise ValueError("ARCHIVE_TOO_LARGE")
    raw = base64.b64decode(encoded, validate=True)
    sha = hashlib.sha256(raw).hexdigest()
    if len(raw) > LIMIT or expected != "sha256:" + sha:
        raise ValueError("ARCHIVE_DIGEST_MISMATCH")
    names, total = set(), 0
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos = z.infolist()
        if not infos or len(infos) > 256:
            raise ValueError("ARCHIVE_MEMBER_LIMIT")
        for info in infos:
            name = info.filename.rstrip("/")
            mode = (info.external_attr >> 16) & 0o170000
            if not safe_path(name) or "\x00" in info.orig_filename or any(ord(c) < 32 for c in name) or name in names or mode not in (0, stat.S_IFREG, stat.S_IFDIR) or info.flag_bits & 1 or info.file_size > LIMIT:
                raise ValueError("UNSAFE_ARCHIVE_ENTRY")
            names.add(name)
            total += info.file_size
            if total > LIMIT:
                raise ValueError("ARCHIVE_EXPANSION_LIMIT")
            with z.open(info) as member:
                if len(member.read(LIMIT + 1)) != info.file_size:
                    raise ValueError("ARCHIVE_SIZE_MISMATCH")
    return {"sha256": sha, "bytes": len(raw), "members": len(names)}


def verify(data):
    try:
        expected, run, jobs, artifacts = (data[k] for k in ("expected", "run", "jobs", "artifacts"))
        repo, head = expected["repository"], expected["head"]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not hex_id(head, 40) or not all(positive(expected[k]) for k in ("run_id", "workflow_id", "attempt")):
            return blocked("CI_SUBJECT_INVALID")
        if run["repository"]["full_name"] != repo or run["head_sha"] != head or run["id"] != expected["run_id"] or run["workflow_id"] != expected["workflow_id"] or run["run_attempt"] != expected["attempt"] or not passed(run):
            return blocked("CI_RUN_MISMATCH_OR_NOT_SUCCESS")
        required = expected["required_jobs"]
        if not isinstance(required, dict) or not required or jobs["total_count"] != len(jobs["jobs"]):
            return blocked("CI_JOB_SET_INCOMPLETE")
        job_rows = []
        for name, steps in sorted(required.items()):
            matches = [j for j in jobs["jobs"] if j["name"] == name]
            if len(matches) != 1 or not isinstance(steps, list) or not steps or len(set(steps)) != len(steps):
                return blocked("CI_JOB_OR_STEP_REQUIREMENT_INVALID")
            j = matches[0]
            if not positive(j["id"]) or j["run_id"] != run["id"] or j["run_attempt"] != run["run_attempt"] or j["head_sha"] != head or not passed(j):
                return blocked("CI_JOB_MISMATCH_OR_NOT_SUCCESS")
            for name2 in steps:
                matches2 = [s for s in j["steps"] if s["name"] == name2]
                if len(matches2) != 1 or not passed(matches2[0]):
                    return blocked("REQUIRED_CI_STEP_NOT_SUCCESS")
            job_rows.append({"id": j["id"], "name": name, "steps": sorted(steps)})
        required_artifacts = expected["required_artifacts"]
        if not isinstance(required_artifacts, list) or len(set(required_artifacts)) != len(required_artifacts) or artifacts["total_count"] != len(artifacts["artifacts"]):
            return blocked("CI_ARTIFACT_SET_INCOMPLETE")
        archive_rows = []
        for name in required_artifacts:
            matches = [a for a in artifacts["artifacts"] if a["name"] == name]
            if len(matches) != 1:
                return blocked("REQUIRED_ARTIFACT_MISSING_OR_DUPLICATE")
            a = matches[0]
            if not name.startswith(f"run-{run['id']}-attempt-{run['run_attempt']}-"):
                return blocked("ARTIFACT_ATTEMPT_NOT_BOUND")
            if a.get("expired") is not False or not positive(a["id"]) or a["workflow_run"]["id"] != run["id"] or a["workflow_run"]["head_sha"] != head:
                return blocked("ARTIFACT_EXPIRED_OR_WRONG_SUBJECT")
            archive_rows.append({"id": a["id"], "name": name, **inspect_archive(data["archives"][str(a["id"])], a["digest"])})
        body = {"repository": repo, "head": head, "run_id": run["id"], "workflow_id": run["workflow_id"], "attempt": run["run_attempt"], "jobs": job_rows, "artifacts": archive_rows, "artifact_status": "BYTES_VERIFIED" if archive_rows else "NOT_REQUIRED"}
        return {"status": "CI_EVIDENCE_VERIFIED", "evidence": body, "evidence_sha256": digest(canonical(body)), "write_authority": False}
    except (KeyError, TypeError, ValueError, AttributeError, OSError, RuntimeError, zipfile.BadZipFile, NotImplementedError):
        return blocked("CI_EVIDENCE_INVALID_OR_UNAVAILABLE")


if __name__ == "__main__":
    try:
        result = verify(strict_json(sys.stdin.read()))
    except (ValueError, TypeError, AttributeError):
        result = blocked("INVALID_INPUT")
    print(json.dumps(result, sort_keys=True))
