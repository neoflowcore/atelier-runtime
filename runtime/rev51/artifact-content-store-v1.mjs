import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validateDurableResultAcceptanceV1 } from "./durable-result-acceptance-v1.mjs";

const HASH = /^[0-9a-f]{64}$/;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function identity(input) {
  if (typeof input?.ARTIFACT_ID !== "string" || !input.ARTIFACT_ID) throw new Error("ARTIFACT_ID_REQUIRED");
  if (!DOMAIN.test(input.SECURITY_DOMAIN ?? "")) throw new Error("ARTIFACT_SECURITY_DOMAIN_INVALID");
  if (!HASH.test(input.CONTENT_SHA256 ?? "")) throw new Error("ARTIFACT_CONTENT_SHA256_INVALID");
  if (!Number.isSafeInteger(input.SIZE_BYTES) || input.SIZE_BYTES < 0) throw new Error("ARTIFACT_SIZE_BYTES_INVALID");
  return input;
}
function objectPath(root, input, state) {
  identity(input);
  if (state !== "quarantine" && state !== "immutable") throw new Error("ARTIFACT_STORE_STATE_INVALID");
  return join(resolve(root), state, input.SECURITY_DOMAIN, input.CONTENT_SHA256.slice(0, 2), input.CONTENT_SHA256);
}
async function verify(path, input) {
  const bytes = await readFile(path);
  if (bytes.length !== input.SIZE_BYTES || digest(bytes) !== input.CONTENT_SHA256) throw new Error("ARTIFACT_CONTENT_MISMATCH");
  return bytes;
}
async function syncDir(path) {
  const h = await open(path, "r");
  try { await h.sync(); } finally { await h.close(); }
}
async function existing(path, input) {
  try { await verify(path, input); return true; }
  catch (e) { if (e.code === "ENOENT") return false; throw e; }
}
export async function stageArtifactContentV1(root, input, bytes) {
  identity(input);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error("ARTIFACT_BYTES_REQUIRED");
  if (bytes.length !== input.SIZE_BYTES || digest(bytes) !== input.CONTENT_SHA256) throw new Error("ARTIFACT_CONTENT_MISMATCH");
  const target = objectPath(root, input, "quarantine");
  if (await existing(target, input)) return { path: target, replay: true };
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${randomUUID()}`;
  const h = await open(temp, "wx", 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  try {
    if (await existing(target, input)) { await unlink(temp); return { path: target, replay: true }; }
    try { await link(temp, target); }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      await verify(target, input);
      return { path: target, replay: true };
    }
    await syncDir(dirname(target));
    return { path: target, replay: false };
  } finally { await unlink(temp).catch(() => {}); }
}
export async function readArtifactContentV1(root, input, state = "quarantine") {
  return verify(objectPath(root, input, state), input);
}
export async function sealStagedArtifactContentV1(root, input) {
  identity(input);
  if (input.ARTIFACT_STATE !== "QUARANTINED") throw new Error("ARTIFACT_NOT_QUARANTINED");
  const bytes = await readArtifactContentV1(root, input);
  const target = objectPath(root, input, "immutable");
  if (await existing(target, input)) return { path: target, replay: true };
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${randomUUID()}`;
  const h = await open(temp, "wx", 0o400);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  try {
    try { await link(temp, target); }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      await verify(target, input);
      return { path: target, replay: true };
    }
    await syncDir(dirname(target));
    return { path: target, replay: false };
  } finally { await unlink(temp).catch(() => {}); }
}

export async function readAcceptedArtifactContentV1(root, acceptance, artifactId) {
  const check = validateDurableResultAcceptanceV1(acceptance);
  if (!check.ok) throw new Error(`ARTIFACT_ACCEPTANCE_INVALID:${check.errors.join("|")}`);
  const record = acceptance.ACCEPTED_ARTIFACT_MANIFEST.find(item => item.ARTIFACT_ID === artifactId);
  if (!record) throw new Error("ARTIFACT_NOT_ACCEPTED");
  if (record.ARTIFACT_STATE !== "IMMUTABLE" || record.ORIGIN_EXECUTION_ID !== acceptance.EXECUTION_ID) throw new Error("ARTIFACT_ACCEPTANCE_BINDING_MISMATCH");
  return readArtifactContentV1(root, record, "immutable");
}
