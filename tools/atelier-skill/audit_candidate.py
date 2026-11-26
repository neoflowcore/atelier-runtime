"""Verify the candidate manifest and exact installed ZIP contents, not release authority."""
import argparse
import hashlib
import json
import stat
import zipfile
from pathlib import Path
from prepare_manifest import prepare


def audit(root, archive=None):
    root = Path(root).resolve(strict=True)
    release = root / ".atelier/releases"
    spec = json.loads((release / "spec.v1.json").read_text(encoding="utf-8"))
    manifest = json.loads((release / "manifest.v1.json").read_text(encoding="utf-8"))
    registry = json.loads((release / "registry.v1.json").read_text(encoding="utf-8"))
    if prepare(root, spec) != manifest:
        raise ValueError("MANIFEST_NOT_REPRODUCIBLE")
    if registry["stable"] or registry["revoked"] or (release / "registry.v1.sig").exists():
        raise ValueError("CANDIDATE_REGISTRY_NOT_EMPTY")
    skill = root / ".agents/skills/atelier-dev"
    expected = {}
    for p in skill.rglob("*"):
        if p.is_symlink():
            raise ValueError("SKILL_SYMLINK_DENIED")
        if p.is_file():
            if p.suffix in {".pyc", ".pyo"} or "__pycache__" in p.parts:
                raise ValueError("SKILL_CACHE_DENIED")
            expected["atelier-dev/" + p.relative_to(skill).as_posix()] = p.read_bytes()
    if not {"atelier-dev/SKILL.md", "atelier-dev/agents/openai.yaml"} <= expected.keys():
        raise ValueError("SKILL_LAYOUT_INVALID")
    result = {"status": "CANDIDATE_AUDIT_PASS", "manifest_sha256": hashlib.sha256((release / "manifest.v1.json").read_bytes()).hexdigest(), "feature_count": len(manifest["features"]), "skill_files": {k: hashlib.sha256(v).hexdigest() for k, v in sorted(expected.items())}, "archive": "NOT_CHECKED", "write_authority": False, "release_authority": False}
    if archive is not None:
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            if len(infos) != len(expected) or {i.filename for i in infos} != expected.keys() or any(i.is_dir() or (i.external_attr >> 16) & 0o170000 not in (0, stat.S_IFREG) or i.file_size != len(expected[i.filename]) or z.read(i) != expected[i.filename] for i in infos):
                raise ValueError("SKILL_ARCHIVE_CONTENT_MISMATCH")
        result.update(archive="BYTES_VERIFIED", archive_sha256=hashlib.sha256(Path(archive).read_bytes()).hexdigest())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("--archive")
    args = parser.parse_args()
    print(json.dumps(audit(args.root, args.archive), indent=2, sort_keys=True))
