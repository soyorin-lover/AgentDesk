# Backend batch 03 execution ledger

Plan: docs/superpowers/plans/2026-10-08-backend-batch-03.md

Ruling: execute in the existing uncommitted checkout, as explicitly authorized; no automatic commit or source worktree. Preserve the live legacy database/config/token. Tests use independent temporary repositories and databases. No model calls.

Pre-flight: tasks 1→2→3 share project/workspace identity; tasks 3→4 share the global resource gate; tasks 4→5 share CheckRun binding and content validity; task 6 consumes all public interfaces. Keep the existing document store schema, adding document kinds without migrating legacy records.

Environment: ordinary shell and Node REPL sandbox initialization fail; controlled elevated shell succeeds. No running service was restarted.

Task 1: complete. Trusted project config/identity, independent DB requirement, no HEAD/dirty/duplicate rejection, old CLI release behavior; project+legacy CLI 2/2. No database schema change: new document kinds only, no legacy migration or backup required. Current live data untouched.

Task 2: complete. Persist workspace intent and idempotency before asynchronous Git creation; public response is 202/preparing, poll task detail. Disable hooks with an application-created empty directory. Verify worktree identity and per-worktree leases. Root overlap/junction, foreign branch/path, restart interruption and Git-success/database-failure tests passed. Interrupted preparation remains needs_recovery even if an owned marker exists; no auto-adoption/retry/cleanup.

Task 3: complete. Resolve repository per task, preserve task-specific session/event/snapshot/acceptance records and legacy single-task mode. Global execution gate retained. Multi-task plus service/crash tests 8/8.

Task 4: complete. Trusted bounded shell:false checks, independent durable CheckRun, frozen executed preset, direct-process cancellation and close confirmation; unknown outcomes block both model/check resources. Check fixture uses actual Node processes. Success/failure/timeout/cancel/multibyte truncation passed. Unknown restart record blocks new work.

Task 5: complete. Recheck digest including HEAD/index and latest run/snapshot on public reads. A check that changed content cannot later become current merely because content was restored. Authenticated project/workspace/check routes, task filters with stable underlying insertion offsets, client additions preserve old call signatures. Targeted checks+HTTP+client 14/14 before additional crash coverage.

Task 6: complete. Final full suite npm test 79/79 (98.5s), TypeScript 5.9.3 strict/noEmit 41 files passed, public client compiled independently with browser libraries only. Real Git/SQLite/HTTP two-task flow passed. Documentation links and whitespace checks passed. One bounded gpt-6.1-sol read-only review and its red→green fixes complete; no additional review loop. Results/API/usage/latest handoff updated. No dependencies installed, real model executed, live service restarted or user data modified. Browser/real-model/Linux remain unverified for this batch.

Ruling: use existing available TypeScript 5.9.3 rather than claiming the historical 6.0.3 compiler; paths only in shell environment. Verification records name the actual version.

Ruling: preserve explicit safe inline scope and no automatic integration/commit/cleanup. Skill shell helpers assume committed history and Bash; use this tracked ledger and native patch/test tools instead.

Final review: one read-only gpt-6.1-sol pass, no extra review loop. P1 unknown check exit could skip quarantine if Git scan failed; fixed quarantine-before-scan and retain leases/fault closed on marker failure. P2 concurrent worktree changes could certify an incomplete digest; fixed bounded path/content revalidation. Both reproduced failing assertions and passed after repair. Self-review startup lease leakage likewise red→green. Unknown child close is tested with a controlled process-boundary fixture; normal checks and backend-crash coverage use real Node processes. Windows inherited descendant streams did not reliably suppress direct close, so that discarded fixture is not evidence of unknown-exit handling or process-tree termination.

Final verification iteration: one full concurrent run timed out the two crash fixture handshakes (5s/15s), while all 77 other assertions passed and isolated crashes passed. Increased only fixture startup waits to 30s/45s, added early-exit diagnostics and cleanup of the exclusively identified check fixture process; product preset bounds unchanged. Whole suite then passed 79/79. Final capability pass reproduced missing cancel_check action during running checks; added the action and reran full suite. Recovery now distinguishes an owned interrupted preparation from an unconfirmed identity without adopting either. Browser updateTask types exclude projectId as the backend does.

Crash-fixture stabilization: a later full run hit the conservative live-PID lease rejection immediately after an owned fixture exited (78/79). Test fixtures now await close and perform bounded reopening only for the exact workspace/database locked error; no production lease weakening, forced cleanup or unrelated process termination. This accommodates transient Windows PID visibility/reuse while retaining fail-closed ownership semantics.
