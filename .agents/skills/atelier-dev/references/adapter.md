# Native adapter operation

The full policy is docs/rev60/R60_NATIVE_ADAPTER_PROTOCOL_v001.md in the selected verified release. Before any selection, keep the rules below.

- Enroll an independently supplied publisher public key, exact fingerprint and generation floor in a private persistent local directory using session_state.py DIRECTORY enroll. This is a human setup step; never auto-enroll or reset a missing state store.
- Fetch fresh GitHub registry and signature from the same main commit, exact release commit/tree and all manifest-bound file bytes; recheck main. Prefer authorized native connector reads and provide the actual snapshot to session_state.py DIRECTORY bind or resume. github_snapshot.py is an optional GET-only REST transport for an already authorized environment. It does not call ChatGPT connectors or create credentials.
- context contains run_id, project_sha256, plan_sha256, repository, branch, head and tree. Bind only after fresh observations. On resume match the stored context and release pin. If the host cannot run scripts or persist trusted state, remain advisory read-only.
- Before approved code changes, use mutation_guard.py to compile a bounded proposal; after the actual connector mutation verify full changed path set, modes, SHA, parent, tree and branch. Use reconcile, then session_state.py DIRECTORY advance with the observed receipt and expected revision. The scripts never grant or perform remote writes. Never invent a grant or receipt. No blind retry.
- See the bundled scripts for input schemas. No private keys or tokens in prompt, ZIP, repository or state files. Production publication, server-side enforcement and actual surface qualification remain independent gates.
