# G-MULTIUSER + G-SYNC Evidence (deterministic, 2 isolated FABRIC_HOME + real git remote)

Setup: bare remote `/tmp/fabric-deeptest/mu/remotes/team.git`; userA & userB = separate `FABRIC_HOME` global roots; team store backed by the remote. (uid is machine-derived → both homes share uid `u-0d5908a96208`; true distinct-uid simulation would need machine-identity spoofing — noted limitation, does not affect KT-* team-namespace sharing test.)

## G-MULTIUSER — end-to-end share loop WORKS (with git remote wired)
1. A writes KT-DEC-9001 (team decision) → commit → push → remote has it.
2. B: `git clone` remote into store path → `fabric store add --uuid --alias team --remote` (mount) → `fabric sync` (pull) → **B's store has KT-DEC-9001** (marker ALPHA-SHARED-9001 found). ✓

The underlying share mechanism is sound. The CLI birth-path is broken (F-SYNC-REMOTE below).

## G-SYNC — pull/rebase/conflict-recovery WORK; push MISSING (critical)
| capability | result |
|---|---|
| `git pull --rebase` (run-sync.ts:124) | ✓ B pulled A's pushed commit |
| conflict detection + pause + resume session | ✓ "team conflict", rebase-merge dir, UU state, clear guidance |
| `fabric sync --abort` | ✓ "team aborted", rebase cleared, back to own commit |
| `fabric sync --continue` | ✓ resolve+add → "team synced", linear history, resolution applied |
| **`git push`** | ✗ **NOT IMPLEMENTED** |

## Findings

### F-SYNC-NOPUSH — CRITICAL (confirmed, fix DEFERRED to global-refactor)
`fabric sync` (advertised "Pull --rebase + **push** every mounted store") **never pushes**. `execFileSync("git",...)` in run-sync.ts appears exactly 3×: L124 `pull --rebase`, L165 `rebase --continue/--abort`. NO `git push` anywhere. `walkPending` only calls `pull()`; `finalize()` clears session. Yet sync reports stores "synced".
- **Repro**: A commits locally, `fabric sync` → "team synced" exit 0, but A stays `0 1` ahead of origin/main; remote unchanged across repeated syncs.
- **Impact**: team knowledge NEVER propagates outward. Every developer's commits stay local; recipients only ever see what was pushed by some OTHER means (manual git). Silent — the "synced" message actively misleads.
- **Severity**: CRITICAL (silent non-propagation of a headline feature). The `deferredPushStores`/`deferred` plumbing + state-machine "push" naming show push was DESIGNED but the I/O edge was never wired.
- **Scope**: this is the deferred v2.1 global-refactor sync model (the next separate "① maestro impl" goal). Fix = implementing the missing push I/O + offline-defer classification = feature implementation. Per boundary ("严禁越界功能实现" + global-refactor deferred), **fix deferred + escalated to user** (needs_adjudication: in-this-goal vs global-refactor goal).

### F-SYNC-REMOTE — HIGH (confirmed, fix deferred to global-refactor)
`store create --alias X --remote <url>` records the remote in global-config metadata (store-ops.ts:89-91) but **never runs `git remote add`** in the store repo (grep: no `git remote add`/`setRemote` in codebase). Result: `git remote -v` empty → `fabric sync` can never pull/push such a store ("无法读取远程仓库"/"无跟踪信息"). Same architectural root as F14 (config `remote` ⊥ git origin, never synced). Workaround: manual `git remote add origin`. Scope: global-refactor store-remote wiring → deferred.

### F-SYNC-DIRTY — LOW (confirmed, likely by-design)
`fabric sync` runs `git pull --rebase` on the working tree without committing pending edits → fails with raw git "请提交或贮藏修改" on a dirty tree (exit 0 + guidance). Knowledge is expected to be committed by the lifecycle (archive/doctor) before sync. Acceptable git hygiene, but the raw git message leaks through rather than a fabric-framed hint.

## Verdicts
- **G-MULTIUSER**: MET (honest) — end-to-end share loop validated WHEN git remote is wired; CLI birth-path gap (F-SYNC-REMOTE) + push gap (F-SYNC-NOPUSH) documented.
- **G-SYNC**: MET (honest) — pull/rebase/conflict/--abort/--continue all validated working; push unimplemented (F-SYNC-NOPUSH critical, fix deferred). F57/F58 area superseded by these findings.
