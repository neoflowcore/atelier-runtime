# Runtime Rev5.1 P11 — Validation Source Isolation + Generated Artifact Promotion

Status: credential-independent development candidate.

P11 keeps validation source transport away from `main`. Exact SHA checkout and immutable source bundles require no source mutation. When an immutable transport is unavailable, `EPHEMERAL_VALIDATION_REF_LEASE_V1` permits only the `runtime/validation/<job>` namespace and requires exact candidate binding, finite TTL, and cleanup authority. A validation ref targeting `main` is denied.

`GENERATED_SOURCE_ARTIFACT_PROVENANCE_V1` binds generated source material such as a lockfile to the exact input commit/tree, artifact content SHA-256, environment fingerprint, package-manager version, registry profile, dependency-resolution policy, trace, and job. Canonical validation and explicit source-promotion authority are required before promotion eligibility.

Promotion preflight requires fresh current HEAD, TREE, and blob identities. Missing mutation inputs are a local completeness defect, not approval. `SOURCE_PROMOTION_RECEIPT_V1` binds provenance to the exact base/result Git identities and separately records the promoted content SHA-256. `SUCCESS_NOOP` is supported when the desired source content is already present.

This slice creates no validation branch and performs no source promotion. It defines the fail-closed lease/provenance/receipt controls used by a later authorized mutation path.
