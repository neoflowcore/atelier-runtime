# Runtime Rev5.1 — P2J Authoritative GC / Tombstone

P2J makes physical artifact-byte deletion subordinate to authoritative acceptance and cleanup completion. GC is eligible only after acceptance, provider saga completion, transport deregistration, resource cleanup terminality, and billing stop/not-applicable. A durable tombstone retains acceptance-journal, receipt, artifact-manifest, and content hashes before byte deletion is allowed.

This preserves the invariant `BLOB_EXISTENCE != AUTHORITATIVE_ARTIFACT_ACCEPTANCE` while permitting safe garbage collection.
