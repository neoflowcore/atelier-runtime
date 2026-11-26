import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const pins = Object.freeze({
  "R52_RUNTIME_INTERFACE_FREEZE_v001.json": "ed29abf6074287f9eb5e34424aff06518e856c5d",
  "R52_RUNTIME_DEVELOPMENT_SEAL_v001.json": "51c5569d0e8be96730c6b3156e928176f8f05999",
  "RUNTIME_REV52_HANDOFF_BUNDLE_V1.json": "803bf3b24fa97dc130c4ac98f8fbebd2195f44d8",
  "runtime/rev52/project-run-state-v2.mjs": "8ef98bc8330e8c36b98bbe45f8a5e779c583c2d9",
  "runtime/rev52/source-mutation-authority-v1.mjs": "3176b13f953a1449e4ef75d62fd32d5d504db26d",
  "runtime/rev52/source-progress-resolver-v1.mjs": "5f4ba4491a3c8e072ce0f7ab67cbdf9632754b7f",
  "pilote/rev52/runtime-dependency-bind-v1.mjs": "a15ab0123bbb4abc690522aae48e30ebcf331a7b",
  "pilote/rev52/continuation-response-gate-v1.mjs": "ac4573ac9cc3e07d526a46971f2eb3c19617a4bb"
});
const sha40 = v => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
const sha64 = v => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const deny = reason => ({ status: "BLOCKED", reason, writeAuthority: false, remoteMutationCount: 0 });
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

export async function loadFrozenContracts() {
  const bytes = {};
  for (const [path, expected] of Object.entries(pins)) {
    bytes[path] = await readFile(new URL(path, root));
    if (blob(bytes[path]) !== expected) throw new Error(`FROZEN_BLOB_MISMATCH:${path}`);
  }
  const load = path => import(new URL(path, root).href);
  const state = await load("runtime/rev52/project-run-state-v2.mjs");
  const authority = await load("runtime/rev52/source-mutation-authority-v1.mjs");
  const progress = await load("runtime/rev52/source-progress-resolver-v1.mjs");
  const pilote = await load("pilote/rev52/continuation-response-gate-v1.mjs");
  const handoff = await load("pilote/rev52/runtime-dependency-bind-v1.mjs");
  const result = handoff.verifyRuntimeRev52HandoffV1({
    handoff: JSON.parse(bytes["RUNTIME_REV52_HANDOFF_BUNDLE_V1.json"]),
    interfaceFreeze: JSON.parse(bytes["R52_RUNTIME_INTERFACE_FREEZE_v001.json"]),
    developmentSeal: JSON.parse(bytes["R52_RUNTIME_DEVELOPMENT_SEAL_v001.json"]),
    expectedInterfaceDigest: "d6b22817a194b864611118e36d19bb1fda0eeca6b8a60eda31bec82b5bf622c4"
  });
  if (!result.ok) throw new Error("FROZEN_HANDOFF_INVALID");
  return { state, authority, progress, pilote, binding: result };
}

export async function decide(input) {
  try {
    const c = await loadFrozenContracts();
    const { selection, identity, observation, state, envelope, actions, proposed, checkpoint } = input;
    if (selection?.status !== "BOUND" || selection.publisher_verified !== true || selection.write_authority !== false || !selection.enabled_features?.includes("runtime.control") || !sha40(selection.release?.commit) || !sha64(selection.release?.manifest_sha256)) return deny("RELEASE_OR_CAPABILITY_UNBOUND");
    if (checkpoint && (checkpoint.releaseId !== selection.release.id || checkpoint.releaseCommit !== selection.release.commit || checkpoint.manifestSha256 !== selection.release.manifest_sha256)) return deny("CHECKPOINT_RELEASE_DRIFT");
    if (![identity.projectIdentityDigest, identity.authoritativePlanSetDigest, identity.sourceManifestDigest].every(sha64) || !sha40(identity.head) || !sha40(identity.tree) || !/^pilote-CS-[A-Za-z0-9._-]+$/.test(identity.branch) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity.repository)) return deny("IDENTITY_INVALID");
    if (observation.repository !== identity.repository || observation.branch !== identity.branch || observation.head !== identity.head || observation.tree !== identity.tree) return deny("REMOTE_DRIFT");
    if (!c.state.validateProjectRunStateV2(state).ok || state.projectIdentityDigest !== identity.projectIdentityDigest || state.authoritativePlanSetDigest !== identity.authoritativePlanSetDigest || state.sourceManifestDigest !== identity.sourceManifestDigest || state.currentDevelopmentBranch !== identity.branch || state.currentSourceIdentity?.head !== identity.head || state.currentSourceIdentity?.tree !== identity.tree || state.runtimeInterfaceVersion !== "5.2-FROZEN" || state.runState !== "ACTIVE") return deny("PROJECT_STATE_MISMATCH");
    const rebuilt = c.authority.compileSourceMutationAuthorityEnvelopeV1(envelope);
    if (rebuilt.MUTATION_AUTHORITY_ENVELOPE_SHA256 !== envelope.MUTATION_AUTHORITY_ENVELOPE_SHA256 || envelope.projectIdentityDigest !== identity.projectIdentityDigest || envelope.authoritativePlanSetDigest !== identity.authoritativePlanSetDigest || envelope.targetRepository !== identity.repository || envelope.developmentBranchOrBranchClass !== identity.branch) return deny("AUTHORITY_ENVELOPE_MISMATCH");
    if (!Array.isArray(actions) || !proposed || !["read", "source.commit", "draft.pr"].includes(proposed.operation) || proposed.forcePush !== false || proposed.destructive !== false || proposed.targetRepository !== identity.repository || proposed.developmentBranchOrBranchClass !== identity.branch || proposed.expectedHead !== identity.head || proposed.baseTree !== identity.tree) return deny("MUTATION_SCOPE_DENIED");
    const authority = c.authority.evaluateSourceMutationAuthorityReuseV1({ envelope: rebuilt, current: identity, proposed });
    if (!authority.reusable) return deny(authority.reason ?? "AUTHORITY_BOUNDARY");
    const next = c.progress.resolveGlobalNextLegalActionV1({ actions, closurePreflightPass: false });
    const response = c.pilote.compilePiloteResponseGateV1({ runtimeDecision: next });
    return { status: "ADVISORY_DECISION", runtimeInterfaceDigest: c.binding.runtimeInterfaceDigest, release: selection.release, identity, next, authority, response, writeAuthority: false, remoteMutationCount: 0 };
  } catch (error) {
    return deny(String(error?.message ?? "INVALID_INPUT"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try { console.log(JSON.stringify(await decide(JSON.parse(input)))); }
  catch { console.log(JSON.stringify(deny("INVALID_INPUT_JSON"))); }
}
