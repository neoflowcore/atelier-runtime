import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProjectTargetMembershipV1,
  compileProjectSourceManifestV1,
  resolveAuthoritativePlanSetV1,
  resolveCurrentProjectIdentityV1,
  validateProjectSourceManifestV1
} from "../runtime/rev51/project-identity-plan-binding-v1.mjs";

const H = "a".repeat(64);
const current = {
  projectId: "project-runtime",
  projectSlugOrName: "runtime",
  projectSpecificPlanId: "runtime-v017",
  repositorySet: ["neoflowcore/atelier-runtime"],
  primaryRepository: "neoflowcore/atelier-runtime",
  workspaceRoots: ["/workspace/runtime"],
  providerTargetSet: ["github"],
  identityEvidence: ["current-project-user"]
};

function manifest(identityDigest, overrides = {}) {
  return compileProjectSourceManifestV1({
    projectIdentityDigest: identityDigest,
    sourceManifestId: "runtime-source-manifest",
    sourceManifestVersion: "1",
    authoritativePlanRefs: [
      { planId: "runtime-v017", exactTitleOrFilename: "ATELIER POST-REV5.1 RUNTIME-FIRST REINFORCED PLAN v017", projectLocalSourceRef: "project:runtime-v017", version: "017", digest: H, role: "MASTER_PLAN", precedence: 1 },
      { planId: "runtime-p26", exactTitleOrFilename: "R51_P26_RUNTIME_INTERFACE_FREEZE_PRECHECK.md", projectLocalSourceRef: "repo:docs/rev51/R51_P26_RUNTIME_INTERFACE_FREEZE_PRECHECK.md", version: "1", role: "PHASE_PLAN", precedence: 2 }
    ],
    activeMasterPlanId: "runtime-v017",
    activePhasePlanId: "runtime-p26",
    manifestEvidence: ["current-project-plan"],
    ...overrides
  });
}

test("project-local identity outranks a different current-user fallback", () => {
  const out = resolveCurrentProjectIdentityV1({
    projectLocalIdentity: current,
    currentProjectUserIdentity: { ...current, projectId: "other-project" }
  });
  assert.equal(out.status, "RESOLVED");
  assert.equal(out.identity.projectId, "project-runtime");
  assert.equal(out.identity.resolvedFrom, "PROJECT_LOCAL_SOURCE");
});

test("global recent and memory fields cannot establish identity authority", () => {
  const out = resolveCurrentProjectIdentityV1({
    globalRecentIdentity: current,
    memoryIdentity: current,
    personalContextIdentity: current
  });
  assert.equal(out.status, "UNRESOLVED");
  assert.deepEqual(out.rejectedAuthoritySources, ["GLOBAL_RECENT", "MEMORY", "PERSONAL_CONTEXT"]);
});

test("current-project explicit user identity can bootstrap with project evidence", () => {
  const out = resolveCurrentProjectIdentityV1({ currentProjectUserIdentity: { ...current, projectId: null } });
  assert.equal(out.status, "RESOLVED");
  assert.equal(out.identity.resolvedFrom, "CURRENT_PROJECT_USER");
  assert.match(out.identity.projectIdentityDigest, /^[0-9a-f]{64}$/);
});

test("repository target membership allows current repository and rejects foreign repository", () => {
  const identity = resolveCurrentProjectIdentityV1({ projectLocalIdentity: current }).identity;
  assert.equal(assertProjectTargetMembershipV1(identity, { repository: "neoflowcore/atelier-runtime" }).allowed, true);
  assert.deepEqual(assertProjectTargetMembershipV1(identity, { repository: "neoflowcore/LightHWP" }), { allowed: false, code: "TARGET_REPOSITORY_IDENTITY_MISMATCH" });
});

test("provider and workspace membership are enforced once their sets are bound", () => {
  const identity = resolveCurrentProjectIdentityV1({ projectLocalIdentity: current }).identity;
  assert.equal(assertProjectTargetMembershipV1(identity, { provider: "github", workspaceRoot: "/workspace/runtime" }).allowed, true);
  assert.equal(assertProjectTargetMembershipV1(identity, { provider: "digitalocean" }).code, "TARGET_PROVIDER_IDENTITY_MISMATCH");
  assert.equal(assertProjectTargetMembershipV1(identity, { workspaceRoot: "/workspace/foreign" }).code, "TARGET_WORKSPACE_IDENTITY_MISMATCH");
});

test("source manifest is identity-bound and validates its own digest", () => {
  const identity = resolveCurrentProjectIdentityV1({ projectLocalIdentity: current }).identity;
  const m = manifest(identity.projectIdentityDigest);
  assert.equal(validateProjectSourceManifestV1(m, identity.projectIdentityDigest).ok, true);
  assert.equal(validateProjectSourceManifestV1(m, "b".repeat(64)).errors.includes("SOURCE_MANIFEST_IDENTITY_MISMATCH"), true);
});

test("manifest requires the active master plan to be a MASTER_PLAN ref", () => {
  const identity = resolveCurrentProjectIdentityV1({ projectLocalIdentity: current }).identity;
  assert.throws(() => compileProjectSourceManifestV1({
    projectIdentityDigest: identity.projectIdentityDigest,
    sourceManifestId: "m",
    sourceManifestVersion: "1",
    authoritativePlanRefs: [{ planId: "phase", exactTitleOrFilename: "phase.md", projectLocalSourceRef: "p", version: "1", role: "PHASE_PLAN" }],
    activeMasterPlanId: "phase"
  }), /ACTIVE_MASTER_PLAN_REF_MISSING/);
});

test("plan set resolves only when manifest-bound project sources are available", () => {
  const identity = resolveCurrentProjectIdentityV1({ projectLocalIdentity: current }).identity;
  const m = manifest(identity.projectIdentityDigest);
  const partial = resolveAuthoritativePlanSetV1({ identity, manifest: m, availableProjectSources: ["project:runtime-v017"] });
  assert.equal(partial.status, "MANIFEST_BOUND_SOURCE_REFRESH_REQUIRED");
  assert.deepEqual(partial.missingSourceRefs, ["repo:docs/rev51/R51_P26_RUNTIME_INTERFACE_FREEZE_PRECHECK.md"]);
  const full = resolveAuthoritativePlanSetV1({ identity, manifest: m, availableProjectSources: ["project:runtime-v017", "repo:docs/rev51/R51_P26_RUNTIME_INTERFACE_FREEZE_PRECHECK.md"] });
  assert.equal(full.status, "RESOLVED");
  assert.equal(full.activeMasterPlanId, "runtime-v017");
});
