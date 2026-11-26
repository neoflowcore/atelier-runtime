"""Local trust and release-pin state; never grants or performs remote writes."""
import argparse
import json
import os
import sqlite3
import stat
import subprocess
import sys
from pathlib import Path
from resolve_release import REPO, blocked, digest, hex_id, strict_json
from verify_registry import verify


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def private_dir(path, create=False):
    path = Path(path).expanduser().absolute()
    if create:
        path.mkdir(mode=0o700, parents=False, exist_ok=True)
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
        raise ValueError("UNTRUSTED_STATE_DIRECTORY")
    return path


def connect(path, create=False):
    path = private_dir(path, create) / "state.sqlite3"
    if create:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(fd)
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
        raise ValueError("UNTRUSTED_STATE_FILE")
    db = sqlite3.connect(path, timeout=5, isolation_level=None)
    db.execute("PRAGMA synchronous=FULL")
    return db


def enroll(directory, pem, expected_fingerprint, minimum_generation):
    if not hex_id(expected_fingerprint, 64) or digest(pem) != expected_fingerprint or type(minimum_generation) is not int or minimum_generation < 1:
        raise ValueError("TRUST_ANCHOR_INVALID")
    if not pem.startswith("-----BEGIN PUBLIC KEY-----") or subprocess.run(["openssl", "pkey", "-pubin", "-noout"], input=pem.encode(), capture_output=True, timeout=10).returncode:
        raise ValueError("PUBLIC_KEY_INVALID")
    trust = {"repository": REPO, "public_key_pem": pem, "key_sha256": expected_fingerprint, "minimum_generation": minimum_generation}
    with connect(directory, create=True) as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("CREATE TABLE runs (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("INSERT INTO metadata VALUES (?, ?)", ("trust", canonical(trust)))
    return {"status": "ENROLLED", "key_sha256": expected_fingerprint, "write_authority": False}


def get(db, table, key):
    row = db.execute("SELECT value FROM " + table + " WHERE " + ("id" if table == "runs" else "key") + " = ?", (key,)).fetchone()
    return strict_json(row[0]) if row else None


def put(db, table, key, value):
    db.execute("INSERT OR REPLACE INTO " + table + " VALUES (?, ?)", (key, canonical(value)))


def project_context(ctx):
    keys = ("run_id", "project_sha256", "plan_sha256", "repository", "branch", "head", "tree")
    result = {k: ctx[k] for k in keys}
    if not all(isinstance(v, str) and v for v in result.values()) or not all(hex_id(result[k], 64) for k in ("project_sha256", "plan_sha256")) or not all(hex_id(result[k], 40) for k in ("head", "tree")):
        raise ValueError("PROJECT_CONTEXT_INVALID")
    return result


def bind(directory, snapshot, context, resume=False, now=None):
    try:
        ctx = project_context(context)
        with connect(directory) as db:
            db.execute("BEGIN IMMEDIATE")
            trust = get(db, "metadata", "trust")
            previous = get(db, "metadata", "registry")
            if trust is None:
                return blocked("PUBLISHER_TRUST_NOT_ENROLLED")
            run = get(db, "runs", ctx["run_id"])
            if resume:
                if run is None or run["context"] != ctx:
                    return blocked("CHECKPOINT_MISSING_OR_PROJECT_DRIFT")
            elif run is not None:
                return blocked("RUN_ALREADY_BOUND_USE_RESUME")
            data = dict(snapshot)
            data.pop("checkpoint", None)
            if resume:
                data["checkpoint"] = run["release"]
            result = verify(data, trust, previous, now)
            if result.get("publisher_verified") is True:
                put(db, "metadata", "registry", result["verified_registry_state"])
            if result["status"] == "BOUND":
                release = result["release"]
                pin = {k: release[k] for k in ("id", "commit", "manifest_sha256")}
                if not resume:
                    put(db, "runs", ctx["run_id"], {"context": ctx, "release": pin, "revision": 0, "evidence": []})
                result["run_id"] = ctx["run_id"]
            return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError, sqlite3.Error):
        return blocked("TRUST_STATE_UNAVAILABLE_OR_INVALID")


def advance(directory, context, expected_revision, receipt):
    """Record an already observed effect; caller must independently verify evidence."""
    try:
        ctx = project_context(context)
        with connect(directory) as db:
            db.execute("BEGIN IMMEDIATE")
            run = get(db, "runs", ctx["run_id"])
            if run is None or run["context"] != ctx or type(expected_revision) is not int or run["revision"] != expected_revision:
                return blocked("CHECKPOINT_CAS_REJECTED")
            if receipt.get("status") != "REMOTE_EFFECT_VERIFIED" or receipt.get("repository") != ctx["repository"] or receipt.get("branch") != ctx["branch"] or receipt.get("base_head") != ctx["head"] or not all(hex_id(receipt.get(k), 40) for k in ("head", "tree")) or not hex_id(receipt.get("proposal_sha256"), 64):
                return blocked("CHECKPOINT_RECEIPT_INVALID")
            run["context"] = {**ctx, "head": receipt["head"], "tree": receipt["tree"]}
            run["revision"] += 1
            run["evidence"].append(receipt["proposal_sha256"])
            put(db, "runs", ctx["run_id"], run)
            return {"status": "CHECKPOINT_SAVED", "revision": run["revision"], "write_authority": False}
    except (OSError, ValueError, KeyError, TypeError, AttributeError, sqlite3.Error):
        return blocked("TRUST_STATE_UNAVAILABLE_OR_INVALID")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory")
    p.add_argument("operation", choices=["enroll", "bind", "resume", "advance"])
    a = p.parse_args()
    try:
        d = strict_json(sys.stdin.read())
        if a.operation == "enroll":
            r = enroll(a.directory, d["public_key_pem"], d["expected_fingerprint"], d["minimum_generation"])
        elif a.operation == "advance":
            r = advance(a.directory, d["context"], d["expected_revision"], d["receipt"])
        else:
            r = bind(a.directory, d["snapshot"], d["context"], a.operation == "resume")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, sqlite3.Error):
        r = blocked("STATE_OPERATION_DENIED")
    print(json.dumps(r, sort_keys=True))
