import { createHash } from "node:crypto";

function canon(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("ONLY_SAFE_INTEGERS_ALLOWED");
    return String(v);
  }
  if (typeof v === "string") {
    if (!/^[\x20-\x7E]*$/.test(v)) throw new Error("NON_ASCII_STRING_NOT_ALLOWED_BY_V1_REFERENCE_PROFILE");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  throw new Error("UNSUPPORTED_JSON_TYPE");
}

export function canonicalizeExecutionV1(value) {
  return Buffer.from(canon(value), "utf8");
}

export function computeExecutionIntentSha256(value) {
  const copy = structuredClone(value);
  delete copy.INTENT_SHA256;
  return createHash("sha256").update(canonicalizeExecutionV1(copy)).digest("hex");
}
