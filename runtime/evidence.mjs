import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export function evidenceDirectory() {
  return resolve(process.env.ATELIER_RUNTIME_EVIDENCE_DIR ?? "runtime-evidence");
}

export async function writeStageEvidence(name, value) {
  try {
    const directory = evidenceDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    console.error(`G7_EVIDENCE_WRITE_WARNING=${name}:${error?.code ?? error?.name ?? "WRITE_FAILURE"}`);
    return false;
  }
}

export async function readStageEvidence(name) {
  try {
    return JSON.parse(await readFile(join(evidenceDirectory(), `${name}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readEvidenceFile(name) {
  try {
    return JSON.parse(await readFile(join(evidenceDirectory(), name), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
