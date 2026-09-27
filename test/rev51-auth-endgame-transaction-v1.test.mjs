import test from "node:test";
import assert from "node:assert/strict";
import {
  compileAuthEndgameTransactionV1,
  compileFinalAuthBindManifestV1,
  compileFinalCredentialBindManifestV1,
  compileTransitiveLiveAuthDependencyClosureV1,
  evaluateAuthEndgameClosurePreflightV1
} from "../runtime/rev51/auth-endgame-transaction-v1.mjs";

const I = "1".repeat(64);
const req = { provider: "github", capability: "workflow-read", scope: "neoflowcore/atelier-runtime", reason: "live verification" };

test("credential manifest deduplicates requirements and denies raw-secret chat path", () => {
  const m = compileFinalCredentialBindManifestV1([req, req]);
  assert.equal(m.requirements.length, 1);
  assert.equal(m.rawSecretChatPath, "DENY");
  assert.equal(m.interactionBudget, 1);
  assert.match(m.CREDENTIAL_BIND_MANIFEST_SHA256, /^[0-9a-f]{64}$/);
});

test("auth manifest is project-identity bound and fixes one-prompt maximum", () => {
  const credentials = compileFinalCredentialBindManifestV1([req]);
  const auth = compileFinalAuthBindManifestV1({ projectIdentityDigest: I, credentialManifest: credentials });
  assert.equal(auth.interactiveAuthPromptMaxPerProjectRun, 1);
  assert.equal(auth.secondAuthPromptNormalPath, 0);
  assert.equal(auth.unresolvedRequirementCount, 1);
  assert.throws(() => compileFinalAuthBindManifestV1({ projectIdentityDigest: "bad", credentialManifest: credentials }), /PROJECT_IDENTITY_DIGEST_REQUIRED/);
});

test("auth endgame is deferred before project development completes", () => {
  const out = evaluateAuthEndgameClosurePreflightV1({ projectDevelopmentComplete: false, unresolvedRequirementCount: 5 });
  assert.equal(out.decision, "DEFER_AUTH_CONTINUE_DEVELOPMENT");
  assert.equal(out.interactiveBoundaryRequired, false);
});

test("project complete with no unresolved auth reuses existing authority without interaction", () => {
  const out = evaluateAuthEndgameClosurePreflightV1({ projectDevelopmentComplete: true, unresolvedRequirementCount: 0 });
  assert.equal(out.decision, "READY_NO_INTERACTION");
});

test("project complete aggregates unresolved auth into one boundary", () => {
  const out = evaluateAuthEndgameClosurePreflightV1({ projectDevelopmentComplete: true, unresolvedRequirements: [req, { ...req, provider: "digitalocean" }], interactivePromptCount: 0 });
  assert.equal(out.decision, "ONE_AGGREGATED_AUTH_BOUNDARY");
  assert.equal(out.allowedPromptCount, 1);
});

test("second interactive auth prompt is denied", () => {
  const out = evaluateAuthEndgameClosurePreflightV1({ projectDevelopmentComplete: true, unresolvedRequirementCount: 1, interactivePromptCount: 1 });
  assert.equal(out.decision, "SECOND_AUTH_PROMPT_DENIED");
});

test("transitive live-auth dependency closure is deterministic", () => {
  const closure = compileTransitiveLiveAuthDependencyClosureV1({ roots: ["provider-live"], dependencies: { "provider-live": ["source-live", "binding-live"], "source-live": ["github-auth"], "binding-live": ["github-auth"] } });
  assert.deepEqual(closure.closure, ["binding-live", "github-auth", "provider-live", "source-live"]);
});

test("auth endgame transaction compiles only after a ready preflight", () => {
  const credentials = compileFinalCredentialBindManifestV1([req]);
  const auth = compileFinalAuthBindManifestV1({ projectIdentityDigest: I, credentialManifest: credentials });
  const closure = compileTransitiveLiveAuthDependencyClosureV1({ roots: ["provider-live"], dependencies: { "provider-live": [] } });
  const preflight = evaluateAuthEndgameClosurePreflightV1({ projectDevelopmentComplete: true, unresolvedRequirementCount: 1, interactivePromptCount: 0 });
  const tx = compileAuthEndgameTransactionV1({ authManifest: auth, closure, preflight });
  assert.equal(tx.interactionMode, "SINGLE_AGGREGATED_BOUNDARY");
  assert.equal(tx.secondPromptAllowed, false);
  assert.throws(() => compileAuthEndgameTransactionV1({ authManifest: auth, closure, preflight: { decision: "DEFER_AUTH_CONTINUE_DEVELOPMENT" } }), /AUTH_ENDGAME_PREFLIGHT_NOT_READY/);
});
