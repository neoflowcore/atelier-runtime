# Runtime B Opaque Authority Binding

Runtime B binds externally produced authority evidence to the exact Task Contract and backend selected by Runtime B. Runtime does not parse or reinterpret Pilote approval, intervention, replan, phase, or task semantics.

The external semantic producer remains responsible for deciding whether an authority artifact means approval. Runtime receives only the immutable SHA-256 digest of that artifact and binds it to:

- Interface V1 identity
- exact Task Contract hash
- exact Runtime B backend binding digest
- exact backend ID and kind
- source-write authority NONE for the Runtime B validation envelope

A binding created for one backend cannot be reused with another backend. A binding created for one Task Contract cannot be reused with another Task Contract. Any field extension or digest mismatch fails closed.

```text
AUTHORITY_EVIDENCE_CLASS=OPAQUE_EXTERNAL_AUTHORITY_EVIDENCE
PILOTE_APPROVAL_SEMANTIC_INTERPRETATION=NONE
PILOTE_RUNTIME_REIMPLEMENTATION=DENY
CROSS_BACKEND_REUSE=DENY
VALIDATION_EXECUTION_SOURCE_WRITE=ZERO
LEASE_STATE=NOT_IMPLEMENTED_PLAN_D
```

This primitive is intentionally narrower than a Pilote approval envelope. A future cross-stack adapter may supply the digest of an authoritative Pilote artifact without changing Interface V1 or the 27 frozen Task Contract fields.
