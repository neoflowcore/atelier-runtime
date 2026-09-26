# Runtime Rev5.1 P16L — Provider Schema Drift Guard / Conformance

Provider adapter payloads are checked against explicit required/optional fields, enum contracts, and an unknown-field policy. Missing identity fields, unknown enum values, or blocked unknown fields produce `BLOCKED_SCHEMA_DRIFT`, never an implicit PASS. A provider-neutral semantic fixture set covers traffic/source/binding/criteria/credential/timeout/trust-reset/schema-drift cases.
