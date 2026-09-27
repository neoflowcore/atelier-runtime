import { commitDurableResultAcceptanceV1 } from "./durable-result-acceptance-v1.mjs";
import { sealStagedArtifactContentV1 } from "./artifact-content-store-v1.mjs";

// The durable acceptance journal remains the authority. Verify real bytes before
// recording an acceptance decision; immutable bytes are staged before the journal.
export async function commitStoredResultAcceptanceV1(root, statePath, journalPath, request) {
  if (!Array.isArray(request?.QUARANTINED_ARTIFACTS)) throw new Error("QUARANTINED_ARTIFACTS_REQUIRED");
  for (const artifact of request.QUARANTINED_ARTIFACTS) {
    if (artifact.ARTIFACT_STATE !== "QUARANTINED") throw new Error("ARTIFACT_NOT_QUARANTINED");
    await sealStagedArtifactContentV1(root, artifact);
  }
  return commitDurableResultAcceptanceV1(statePath, journalPath, request);
}
