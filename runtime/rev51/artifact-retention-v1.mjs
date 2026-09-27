const CLASSES = new Set(["PINNED", "UNTIL_FINAL_ACCEPTANCE", "UNTIL_ROLLBACK_WINDOW_END", "CACHE_EVICTABLE", "CHECKPOINT_LATEST_N", "TEMPORARY", "AUDIT_LONG_TERM"]);
function safeTime(value) { return Number.isSafeInteger(value) && value >= 0; }
export function evaluateArtifactRetentionV1(artifact, context) {
  if (!artifact || !CLASSES.has(artifact.RETENTION_CLASS)) return { eligible: false, reason: "RETENTION_CLASS_INVALID" };
  if (!context || !safeTime(context.RUNTIME_NOW_MS)) return { eligible: false, reason: "RUNTIME_AUTHORITATIVE_TIME_REQUIRED" };
  if (artifact.ARTIFACT_STATE !== "IMMUTABLE") return { eligible: false, reason: "ARTIFACT_NOT_IMMUTABLE" };
  if (context.SECURITY_DOMAIN !== artifact.SECURITY_DOMAIN) return { eligible: false, reason: "SECURITY_DOMAIN_MISMATCH" };
  if (context.REFERENCED_BY_ACTIVE_EXECUTION !== false) return { eligible: false, reason: "ACTIVE_REFERENCE_UNKNOWN_OR_PRESENT" };
  if (context.SHARED_CONTENT_REFERENCE_COUNT !== 0) return { eligible: false, reason: "SHARED_CONTENT_REFERENCE_UNKNOWN_OR_PRESENT" };
  if (context.RECEIPT_RETAINED !== false) return { eligible: false, reason: "RECEIPT_RETENTION_UNKNOWN_OR_ACTIVE" };
  if (context.CHECKPOINT_ANCESTRY_REFERENCE !== false) return { eligible: false, reason: "CHECKPOINT_ANCESTRY_UNKNOWN_OR_ACTIVE" };
  if (context.EXPLICIT_PIN !== false) return { eligible: false, reason: "EXPLICIT_PIN_UNKNOWN_OR_ACTIVE" };
  if (context.ROLLBACK_ACTIVE !== false) return { eligible: false, reason: "ROLLBACK_UNKNOWN_OR_ACTIVE" };
  if (context.AUTHORITATIVE_GC_TOMBSTONE !== true) return { eligible: false, reason: "GC_TOMBSTONE_REQUIRED" };
  switch (artifact.RETENTION_CLASS) {
    case "PINNED": case "AUDIT_LONG_TERM": return { eligible: false, reason: "RETENTION_PINNED" };
    case "UNTIL_FINAL_ACCEPTANCE": return context.FINAL_ACCEPTANCE_TERMINAL === true ? { eligible: true, reason: "RETENTION_SATISFIED" } : { eligible: false, reason: "FINAL_ACCEPTANCE_NOT_TERMINAL" };
    case "UNTIL_ROLLBACK_WINDOW_END": return safeTime(context.ROLLBACK_WINDOW_END_MS) && context.RUNTIME_NOW_MS >= context.ROLLBACK_WINDOW_END_MS ? { eligible: true, reason: "RETENTION_SATISFIED" } : { eligible: false, reason: "ROLLBACK_WINDOW_NOT_EXPIRED" };
    case "CACHE_EVICTABLE": return context.CACHE_LEASES_RELEASED === true ? { eligible: true, reason: "RETENTION_SATISFIED" } : { eligible: false, reason: "CACHE_LEASES_UNKNOWN_OR_ACTIVE" };
    case "CHECKPOINT_LATEST_N": return context.CHECKPOINT_OUTSIDE_LATEST_N === true && context.RESUME_REFERENCE_RELEASED === true ? { eligible: true, reason: "RETENTION_SATISFIED" } : { eligible: false, reason: "CHECKPOINT_RETENTION_ACTIVE" };
    case "TEMPORARY": return safeTime(context.TEMPORARY_EXPIRES_AT_MS) && context.RUNTIME_NOW_MS >= context.TEMPORARY_EXPIRES_AT_MS ? { eligible: true, reason: "RETENTION_SATISFIED" } : { eligible: false, reason: "TEMPORARY_NOT_EXPIRED" };
  }
}
