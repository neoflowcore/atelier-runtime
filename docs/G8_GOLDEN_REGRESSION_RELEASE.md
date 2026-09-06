# G8 Golden Regression + GitHub-Side V1 Release

## Status

```text
G8_STATUS=COMPLETE
RUNTIME_VERSION=1.0.0
GITHUB_RUNTIME_V1=FROZEN
```

This document seals the GitHub-side Atelier Runtime V1 execution plane after the canonical v004 G8 regression. G8 does not add a control plane and does not expand the execution DSL. Existing G2-G7 execution paths remain authoritative.

## Canonical final gate

```text
EXACT_SHA=PASS
PRIVATE_CALLER=PASS
DUAL_CHECKOUT=PASS
PREFLIGHT=PASS
NODE_RUNTIME=PASS
WEB_RUNTIME=PASS
BROWSER_RUNTIME=PASS
RECEIPT=PASS
RUN_ATTEMPT_BINDING=PASS
FAILURE_CLASSIFICATION=PASS
RUNTIME_VERSION_BINDING=PASS
CALLER_RUNTIME_PINNING=PASS
ACTION_SHA_PINNING=PASS
SOURCE_INTEGRITY=PASS
RUNTIME_ENVIRONMENT_EVIDENCE=PASS
SOURCE_WRITE=ZERO
RAW_SHELL_INPUT=ZERO
AUTO_RETRY=ZERO
GOLDEN_REGRESSION=PASS
```

Final readiness marker:

```text
ATELIER_RUNTIME_V1_GITHUB_EXECUTION_PLANE=READY_FOR_CONTROL_PLANE_INTEGRATION
STOP_GITHUB_RUNTIME_V1=TRUE
```

## Release candidate

```text
RUNTIME_CANDIDATE_SHA=be49fb8f596e4169cfee971ab60463ae88e2ede3
GOLDEN_CANDIDATE_SHA=adf165a1f89a7e649731638e1191c6ceaabbef44
RUNTIME_SELFTEST_RUN=34005683431
GOLDEN_POSITIVE_RUN=34005704303
GOLDEN_INVALID_SHA_NEGATIVE_RUN=34005779499
```

The successful Runtime self-test on `be49fb8f596e4169cfee971ab60463ae88e2ede3` executed the full existing test suite plus the G8 release-policy gate. All 36 Node tests passed.

Release-policy markers:

```text
SECURITY_LINT=PASS workflows=2
G8_RUNTIME_VERSION_BINDING=PASS
G8_EXACT_SHA_POLICY=PASS
G8_DUAL_CHECKOUT_POLICY=PASS
G8_ACTION_SHA_PINNING=PASS
G8_SOURCE_WRITE_ZERO_POLICY=PASS
G8_RAW_SHELL_INPUT_ZERO_POLICY=PASS
G8_AUTO_RETRY_ZERO_POLICY=PASS
G8_RELEASE_POLICY=PASS
```

## Golden positive regression

Golden Target `adf165a1f89a7e649731638e1191c6ceaabbef44` referenced the exact reusable workflow commit `be49fb8f596e4169cfee971ab60463ae88e2ede3` and completed successfully in run `34005704303`.

Raw positive markers included:

```text
G2_RUNTIME_BOOTSTRAP=PASS
G7_RECEIPT_INIT=PASS
G3_CONTRACT_PREFLIGHT=PASS
G4_STAGE_INSTALL=PASS
G4_STAGE_TEST=PASS
G4_TRACKED_SOURCE_INTEGRITY=PASS
G4_LOCKED_STAGES=PASS
G5_DEV_SERVER=PASS
G5_HTTP=PASS
G5_CLEANUP=PASS
G5_WEB_HTTP_RUNTIME=PASS
G6_PLAYWRIGHT_CLI=PASS
G6_CHROMIUM_PROVISION=PASS
G6_BROWSER_SCRIPT=PASS
G6_VISUAL_CERTIFICATION=NOT_CLAIMED
G6_BROWSER_RUNTIME=PASS
G7_RECEIPT_FINALIZED=PASS
G7_RUN_ATTEMPT_BINDING=PASS
G7_SHA_BINDING=PASS
G7_ENVIRONMENT_EVIDENCE=PASS
G7_SOURCE_INTEGRITY=PASS
G7_OVERLAP_GUARD=PASS
G7_RESULT=PASS
G7_RECEIPT_ARTIFACT=PASS
G7_RUNTIME_RECEIPT_GUARDS=PASS
```

Receipt artifact:

```text
ARTIFACT_ID=9980859858
ARTIFACT_SHA256=903363fb76291db120cd0ec2fea0a5000eeffd6ebd2049e8d913478e001614eb
ARTIFACT_SIZE_BYTES=809
```

## Negative regression

### G8 invalid Runtime SHA — new live regression

A dedicated unmerged draft PR #6 changed only the caller input `runtime_sha` to an invalid value while keeping the reusable workflow reference exact. Run `34005779499` failed before Runtime or target checkout with:

```text
G8_FAILURE_CLASS=BLOCKED
G8_FAILURE_STAGE=PREFLIGHT
G8_FAILURE_REASON=INVALID_RUNTIME_SHA
```

The draft PR was closed without merge. Because the request was blocked before Runtime checkout, receipt finalization/publication could not execute; no canonical PASS was produced. This is fail-closed behavior for an invalid source identity.

### Preserved phase negatives

The completed phase evidence remains the regression baseline and was not regenerated unnecessarily:

```text
G3_INVALID_CONTRACT_RUN=34002408556
G4_FAIL_FAST_RUN=34002792768
G4_SOURCE_INTEGRITY_RUN=34002903884
G5_HTTP_NEGATIVE_RUN=34003455511
G5_DEV_SERVER_NEGATIVE_RUN=34003488126
G6_BROWSER_ASSERTION_RUN=34004126274
G6_PROVISIONING_CLASSIFICATION_SELFTEST_RUN=34004202424
G7_APP_FAILURE_RECEIPT_RUN=34004737720
```

The G8 Runtime self-test also revalidated deterministic classification/receipt behavior for BLOCKED, APP_FAILURE, INFRA_FAILURE, TIMEOUT, CANCELLED, SHA mismatch, tracked-source mutation, Runtime SHA mismatch, missing receipt-finalization evidence, floating Action references, arbitrary caller command input, version mismatch, dual-checkout/persisted-credential drift, auto-retry drift, and missing release artifacts.

## Release invariants

Runtime V1 is frozen with:

```text
PROFILE=NODE_WEB_VERIFY
PROFILE_VERSION=1
SOURCE_REF=EXACT_SHA
OS=LINUX_ONLY
PACKAGE_MANAGER=NPM_ONLY
BROWSER=CHROMIUM_ONLY
NODE_VERSION=22.13.0
JOB_TIMEOUT_MINUTES=15
SOURCE_WRITE=DENY
REMOTE_SOURCE_WRITE_AUTHORITY=NONE
RAW_SHELL_INPUT=DENY
ARBITRARY_COMMAND_INPUT=DENY
ARBITRARY_ARGS_INPUT=DENY
ARBITRARY_ENV_INPUT=DENY
CHECKOUT_PERSIST_CREDENTIALS=FALSE
AUTO_RETRY=0
ACTION_DEPENDENCY_PINNING=FULL_COMMIT_SHA
CONTROL_PLANE=OUT_OF_SCOPE_V1
```

The G8 release validator intentionally validates both GitHub Actions YAML forms `uses:` and `- uses:` so full-SHA dependency pinning cannot be bypassed by step syntax variation.

## Acceptance decision

G2-G7 evidence remains valid, the release candidate self-test passes, positive Golden regression passes, invalid exact-SHA input blocks at PREFLIGHT, prior negative evidence remains preserved, and the canonical v004 final gate is satisfied.

```text
G8_GOLDEN_REGRESSION_RELEASE=PASS
ATELIER_RUNTIME_V1_GITHUB_EXECUTION_PLANE=READY_FOR_CONTROL_PLANE_INTEGRATION
STOP_GITHUB_RUNTIME_V1=TRUE
```
