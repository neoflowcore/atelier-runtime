# R60 Capability Matrix v001 — legacy 24 operation inventory

Date: 2026-11-26. Source: fixtures/pilote-builder/rev39/baseline-operation-ids.json and corresponding OpenAPI YAML. The GitHub connector was discovered in the current Atelier project chat; other surfaces are UNTESTED. READ_VERIFIED refers to a successful representative native call in this chat, not proof of all request/response semantics. DISCOVERED is not a live write result. All candidate operations must be requalified from an installed Skill in P3/P4.

| Legacy operationId | Native candidate | Initial state / limitation |
|---|---|---|
| compareCommits | compare_commits | DISCOVERED |
| createApprovedBlob | create_blob | DISCOVERED; approval gate external |
| createApprovedDraftPullRequest | create_pull_request (draft=true) | DISCOVERED; never merge |
| createApprovedPiloteBranch | create_branch | DISCOVERED; explicit SHA and allowlist |
| createApprovedTree | create_tree | DISCOVERED; base tree + path allowlist |
| createGitCommit | create_commit | DISCOVERED; parent/tree binding |
| getBranch | fetch (branch GET) | READ_VERIFIED |
| getCommit | fetch_commit / fetch | DISCOVERED |
| getGitBlob | fetch_blob | DISCOVERED |
| getGitCommit | fetch (git/commits GET) | DISCOVERED |
| getGitTree | fetch (git/trees GET) | READ_VERIFIED |
| getPullRequest | fetch_pr | DISCOVERED |
| getRepository | get_repo / list_repositories | READ_VERIFIED via listing; exact get_repo call pending |
| getRepositoryContent | fetch_file | READ_VERIFIED |
| getWorkflowJob | fetch (job GET) | DISCOVERED; exact payload parity pending |
| getWorkflowRun | fetch (run GET) | READ_VERIFIED in previous discussion, recheck from installed Skill |
| listPullRequests | fetch (pulls GET) / search_prs | DISCOVERED; pagination required |
| listWorkflowRunAttemptJobs | fetch (attempt jobs GET) | DISCOVERED; wrapper latest attempt only; exact GET untested |
| listWorkflowRuns | fetch (runs GET) | DISCOVERED; pagination |
| updateApprovedPiloteBranch | update_ref (expected_sha, force=false) | DISCOVERED; verify CAS rejection |
| dispatchApprovedAtelierRuntimeCaller | none confirmed | UNAVAILABLE on observed native surface; no GET-as-POST or arbitrary dispatch |
| getWorkflowArtifact | fetch (artifact GET) | DISCOVERED; bytes separate |
| getWorkflowJobLogs | fetch_workflow_job_logs | DISCOVERED |
| listWorkflowRunArtifacts | fetch_workflow_run_artifacts / fetch | DISCOVERED; wrapper first page only |

Supplementary candidate: download_workflow_artifact exists; metadata, archive retrieval and actual digest verification are separate. Broader native tools (merge, delete, rerun, auto-merge, ready-for-review, unrestricted content writes) are NOT granted by this matrix.

## Qualification sequence

1. Freshly discover actual callable schema on each supported product surface.
2. Bind repository/branch/head/plan and separate read/write authorization. No credentials in prompts.
3. Verify exact response identities, pagination, errors and stale CAS denial. Use approved sandbox only for mutating tests.
4. Record per-operation/per-surface evidence with timestamps, tool names, target identities, outcomes and remote readback.
5. Only claim E2E_VERIFIED after installed skill invokes required operations and frozen Runtime contract/evidence checks pass. Maintain explicit blockers for missing dispatch and runtime execution.
