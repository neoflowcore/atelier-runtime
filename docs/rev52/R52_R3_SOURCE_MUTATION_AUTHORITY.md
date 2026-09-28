# Runtime Rev5.2 R52-R3 — Source Mutation Authority / Compiler / Semantic CI

R52-R3 reuses the already-promoted Rev5.1 `SOURCE_MUTATION_COMPILER_V1` and semantic CI implementation, and adds the missing Rev5.2 authority-envelope state.

## Authority envelope

Ordinary mutations remain authorized when all of the following remain stable:

- project identity
- authoritative plan set
- bound repository
- approved development branch/class
- non-destructive source-development mutation class

A work-unit change, file-set change, new commit, test fix/addition, docs/build/config change, next in-scope phase, PR existence, CI outcome, checkpoint or reattach is not by itself a new authority boundary.

## Real boundaries

The envelope does not carry across project/repository/protected-branch scope changes, plan-scope expansion, destructive/history-rewrite operations, new secret/credential authority, new paid-resource/cost authority, final merge/release authority, semantic authority conflict, or explicit user stop/restriction.

## Existing compiler/semantic CI reuse

The Rev5.1 compiler already returns `READ_REQUIRED` with `userApprovalRequired=false` for underspecified mutations and denies force-push, blind retry and no-op trigger commits.

The Rev5.1 semantic CI implementation already treats non-contractual test-count drift as a warning rather than functional failure and prioritizes required semantic assertions plus unexpected functional failures.

## R52-R3 gate intent

```text
REDUNDANT_SOURCE_MUTATION_REAPPROVAL = 0
UNDER_SPECIFIED_MUTATION_USER_STOP = 0
BRITTLE_TEST_COUNT_LOOP = 0
FORCE_PUSH = 0
NOOP_COMMIT = 0
```
