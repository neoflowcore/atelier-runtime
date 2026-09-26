import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { evaluateArtifactRetentionV1 } from "./artifact-retention-v1.mjs";
import { buildZeroReferenceProofV1 } from "./artifact-reference-index-v1.mjs";
import { validateBlobDeletionAgainstTombstoneV1 } from "./authoritative-gc-tombstone-v1.mjs";

export const ARTIFACT_PHYSICAL_DELETION_POLICY = "SEALED_REFERENCE_COVERAGE_ZERO_REF_RETENTION_GC_TOMBSTONE";
const SHA = /^[0-9a-f]{64}$/;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function obj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function canon(v) { if (v === null) return "null"; if (["string","boolean"].includes(typeof v)) return JSON.stringify(v); if (typeof v === "number") { if (!Number.isSafeInteger(v)) throw new Error("PHYSICAL_DELETE_NON_SAFE_INTEGER"); return JSON.stringify(v); } if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`; if (obj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`; throw new Error("PHYSICAL_DELETE_UNSUPPORTED_CANONICAL_TYPE"); }
function hash(v) { return createHash("sha256").update(canon(v), "utf8").digest("hex"); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function iso(ms) { if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("RUNTIME_AUTHORITATIVE_TIME_REQUIRED"); return new Date(ms).toISOString(); }
function immutablePath(root, artifact) {
  if (!DOMAIN.test(artifact?.SECURITY_DOMAIN ?? "")) throw new Error("ARTIFACT_SECURITY_DOMAIN_INVALID");
  if (!SHA.test(artifact?.CONTENT_SHA256 ?? "")) throw new Error("ARTIFACT_CONTENT_SHA256_INVALID");
  if (!Number.isSafeInteger(artifact?.SIZE_BYTES) || artifact.SIZE_BYTES < 0) throw new Error("ARTIFACT_SIZE_BYTES_INVALID");
  return join(resolve(root), "immutable", artifact.SECURITY_DOMAIN, artifact.CONTENT_SHA256.slice(0, 2), artifact.CONTENT_SHA256);
}
async function fsyncDir(path) { const h = await open(path, "r"); try { await h.sync(); } finally { await h.close(); } }
async function atomic(path, value) { await mkdir(dirname(path), { recursive: true }); const t = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`; const h = await open(t, "wx", 0o600); try { await h.writeFile(`${JSON.stringify(value, null, 2)}\n`); await h.sync(); } finally { await h.close(); } try { await rename(t, path); await fsyncDir(dirname(path)); } catch (e) { await unlink(t).catch(() => {}); throw e; } }
async function lock(path) { try { return await open(`${path}.lock`, "wx", 0o600); } catch (e) { if (e?.code === "EEXIST") throw new Error("PHYSICAL_DELETE_RECEIPT_LOCKED"); throw e; } }
async function unlock(path, h) { try { await h.close(); } finally { await unlink(`${path}.lock`).catch(() => {}); } }
function fingerprint(request) { const copy = clone(request); delete copy.RUNTIME_NOW_MS; return hash(copy); }
async function readReceiptIfPresent(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch (e) { if (e?.code === "ENOENT") return null; throw e; } }
export async function commitPhysicalArtifactDeletionV1(root, receiptPath, artifact, referenceIndex, gcStore, retentionContext, request) {
  const zeroRefProof = buildZeroReferenceProofV1(referenceIndex, artifact);
  const gc = validateBlobDeletionAgainstTombstoneV1(gcStore, artifact.ARTIFACT_ID, artifact.CONTENT_SHA256);
  if (!gc.ok) throw new Error(gc.code);
  const tombstone = gcStore.TOMBSTONES?.[artifact.ARTIFACT_ID];
  const exactRefs = Object.values(referenceIndex.REFERENCES).filter(r => r.ARTIFACT_ID === artifact.ARTIFACT_ID && r.CONTENT_SHA256 === artifact.CONTENT_SHA256);
  if (exactRefs.length === 0 || exactRefs.some(r => r.ACCEPTANCE_JOURNAL_SHA256 !== tombstone?.ACCEPTANCE_JOURNAL_SHA256)) throw new Error("PHYSICAL_DELETE_TOMBSTONE_REFERENCE_BINDING_MISMATCH");
  const retention = evaluateArtifactRetentionV1(artifact, { ...retentionContext, SHARED_CONTENT_REFERENCE_COUNT: zeroRefProof.ACTIVE_REFERENCE_COUNT, AUTHORITATIVE_GC_TOMBSTONE: true });
  if (!retention.eligible) throw new Error(`PHYSICAL_DELETE_RETENTION_DENIED:${retention.reason}`);
  const requestBody = { IDEMPOTENCY_KEY: request?.IDEMPOTENCY_KEY, ARTIFACT_ID: artifact.ARTIFACT_ID, CONTENT_SHA256: artifact.CONTENT_SHA256, ZERO_REFERENCE_PROOF_SHA256: zeroRefProof.PROOF_SHA256, GC_TOMBSTONE_SHA256: hash(tombstone), RETENTION_REASON: retention.reason };
  if (typeof requestBody.IDEMPOTENCY_KEY !== "string" || !requestBody.IDEMPOTENCY_KEY) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  const fp = fingerprint(requestBody);
  const receiptLock = await lock(receiptPath);
  try {
    const existing = await readReceiptIfPresent(receiptPath);
    if (existing) {
      if (existing.IDEMPOTENCY_KEY === requestBody.IDEMPOTENCY_KEY && existing.REQUEST_SHA256 === fp) return { ok: true, replay: true, result: existing.RESULT, receipt: existing };
      if (existing.IDEMPOTENCY_KEY === requestBody.IDEMPOTENCY_KEY) throw new Error("PHYSICAL_DELETE_IDEMPOTENCY_CONFLICT");
      throw new Error("PHYSICAL_DELETE_RECEIPT_ALREADY_EXISTS");
    }
    const path = immutablePath(root, artifact);
    let result = "SUCCESS_CHANGED";
    try {
      const bytes = await readFile(path);
      if (bytes.length !== artifact.SIZE_BYTES || digest(bytes) !== artifact.CONTENT_SHA256) throw new Error("ARTIFACT_CONTENT_MISMATCH");
      await unlink(path);
      await fsyncDir(dirname(path));
    } catch (e) {
      if (e?.code === "ENOENT") result = "SUCCESS_NOOP";
      else throw e;
    }
    const receipt = {
      RECEIPT_SCHEMA_ID: "ARTIFACT_PHYSICAL_DELETION_RECEIPT_V1",
      RECEIPT_SCHEMA_VERSION: "1",
      POLICY: ARTIFACT_PHYSICAL_DELETION_POLICY,
      IDEMPOTENCY_KEY: requestBody.IDEMPOTENCY_KEY,
      REQUEST_SHA256: fp,
      ARTIFACT_ID: artifact.ARTIFACT_ID,
      CONTENT_SHA256: artifact.CONTENT_SHA256,
      SECURITY_DOMAIN: artifact.SECURITY_DOMAIN,
      ZERO_REFERENCE_PROOF_SHA256: zeroRefProof.PROOF_SHA256,
      REFERENCE_INDEX_COVERAGE_SHA256: zeroRefProof.COVERAGE_SHA256,
      GC_TOMBSTONE_SHA256: requestBody.GC_TOMBSTONE_SHA256,
      RETENTION_REASON: retention.reason,
      RESULT: result,
      COMMITTED_AT: iso(request.RUNTIME_NOW_MS)
    };
    receipt.RECEIPT_SHA256 = hash(receipt);
    await atomic(receiptPath, receipt);
    return { ok: true, replay: false, result, receipt: clone(receipt) };
  } finally { await unlock(receiptPath, receiptLock); }
}
