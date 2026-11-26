# R60 Pre-install development and field acceptance

Rev6.0 remains the development revision. No installation, production trust enrollment, credential change, paid resource, final merge or stable promotion is authorized by this document. Rev6.1 is reserved for defects discovered during subsequent field qualification.

## Pre-install development checklist

| Gate | Required proof |
|---|---|
| D0 | Existing Rev5.2 baseline and frozen files unchanged; exact candidate commit and complete change list |
| D1 | Signed registry, revocation, compatibility, replay and durable checkpoint tests; stable and candidate channels isolated |
| D2 | Universal feature routing with newly introduced IDs, actual module hashes and compatible handler mapping |
| D3 | Real local Git object, parent, tree, stale CAS rejection and correct CAS update, plus read-only reconciliation after grant expiry |
| D4 | Runtime/Pilote frozen-contract integration, actual Node-to-Python handoff; reject authority drift and missing capabilities |
| D5 | Exact CI metadata and artifact-byte verification, negative tests; artifact not required is distinct from verified bytes |
| D6 | Surface admission check refuses missing/stale protection and absent real CAS evidence; no simulated host evidence used as production proof |
| D7 | Candidate manifest reproducibility, full ZIP byte comparison and standard Skill validation |
| D8 | Existing canonical repository selftest on the exact final candidate HEAD with required semantic tests, no regressions |

Record actual evidence for each gate. Do not claim DEVELOPMENT_COMPLETE until all D gates are satisfied. Do not count old CI as new candidate acceptance. Candidate audit is not a final seal or release grant.

## Explicit field channel avoids release/install circularity

Normal installed bootstrap follows only the signed stable registry on main. To test before stable promotion, a human independently enrolls a field-channel key and pins a separately signed, immutable candidate registry with one release entry. The registry commit and candidate commit are distinct. The field probe is read-only and cannot turn a candidate into a stable release. A field run is never silently substituted into a normal project run. The actual sandbox write test is a distinct, explicitly authorized qualification; local Git tests do not qualify GitHub CAS.

## Field gates (after development)

- F0: user installs the exact verified ZIP and establishes independently trusted field pin/key and persistent state on the actual host.
- F1: actual connector branch/tree/manifest/registry reads and verified module bytes; validate script execution and durable state for each surface independently.
- F2: user-authorized sandbox native non-force expected-head stale CAS rejection and valid CAS update; complete readback, Draft PR and CI evidence. Verify actual effective protections; a 403 or missing evidence blocks write admission.
- F3: actual qualified Runtime/Pilote execution and checkpoint recovery, two signed release versions on the same installed bootstrap, feature activation and revocation; real artifact bytes where required. No new tools or providers inferred from remote manifest.
- F4: human review of field defects. Fix field-discovered bugs in Rev6.1; complete final release/promotion only under explicit authority. An empty stable registry is not an operational release.

The local scripts make conditional advisory decisions from actual observations; they cannot call a ChatGPT connector programmatically, confer authority, verify arbitrary claims of user approval, or enforce repository protection. The conservative surface gate handles classic branch protection only. Qualify a separate ruleset-aware adapter if required. Missing host prerequisites are explicit blockers, not a reason to weaken the gate.
