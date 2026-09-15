# Runtime E3 — SYNC-4 Final-Gate Receiver

E3 is a validation-only receiver for authoritative Pilote Rev5 / SYNC-4 evidence.

It does **not** compile or reinterpret Pilote semantics. It consumes externally produced
Rev5/SYNC-4 claims and opaque SHA-256 evidence bindings, then checks them against the
sealed Runtime E PRE-FINAL identity and frozen cross-stack invariants.

```text
REMOTE_MUTATION_AUTHORITY=NONE
SOURCE_WRITE_AUTHORITY=NONE
MERGE_AUTHORITY=NONE
FINAL_MERGE_AUTHORITY=HUMAN_ONLY
INTERFACE_V1_MUTATION=0
FROZEN_27_FIELDS_MUTATION=0
PILOTE_SEMANTIC_REIMPLEMENTATION=0
```

A PASS from this receiver means the supplied authoritative bundle is mechanically
compatible with Runtime E PRE-FINAL. It is not itself proof that the external bundle
is authentic; authenticity/provenance must come from the authoritative Developer A
delivery and exact digest binding.
