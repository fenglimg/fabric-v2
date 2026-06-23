---
name: fabric-import
description: 冷启动从 git log + docs/*.md 回灌 active write store pending knowledge (NOT code/data import). Triggers 导入历史/bootstrap fabric/mine changelog/挖掘 commit.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_propose, mcp__fabric__fab_review
---

> **Surface**: Skill (LLM judgment over git + docs). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md).

## Purpose

One-time per-project cold-start: lift git commits + `docs/*.md` into the active write store as `team`-layer pending entries. Bridges `fabric install`'s 4-7 baseline → accumulated corpus. Run once on adoption or after major refactor.

## Precondition

Invoke only when ANY: user explicit ("import knowledge" / "bootstrap fabric" / "mine changelog"); user named skill; SessionStart hook fired `shouldRecommendImport()`.

Else stop: `没有触发 import 信号；如需手动 import 请显式调用 fabric-import` / `No import signal detected; to manually import, explicitly invoke fabric-import` (per `fabric_language`).

SKIP when: `.fabric/` missing (→ `fabric install`); canonical > `import_skip_canonical_threshold` (default 50); state file `phase=complete` + `last_checkpoint_at <24h`.

Required: `.fabric/` exists, target store resolved, MCP `fab_propose` + `fab_review` registered, working tree reasonably clean.

## Phase 0 — Init

Read/init `.fabric/.import-state.json`. Scan stale `.tmp-import-*`. State-corruption recovery → `Read .../ref/state-recovery.md`.

> 旧 `.fabric/.import-requested` sentinel 机制已下线 (rc.8+);推荐由 SessionStart hook 的 underseed 自检触发(`shouldRecommendImport()`)。本 skill 不再读写 sentinel。

## Phase 0.5 — Config Load

Read `.fabric/fabric-config.json` for tunables (defaults if absent):

| Field | Default |
|---|---|
| `import_window_first_run_months` | 60 |
| `import_window_rerun_months` | 2 |
| `import_max_pending_per_run` | 10 |
| `import_max_commits_scan` | 500 |
| `import_skip_canonical_threshold` | 50 |

First-run vs re-run by state file (ENOENT or `phase != complete && proposed == 0` → first-run window).

### Store routing (v2.1 multi-store)

Import requires an **explicit target store** (E7) — mined entries are NOT auto-routed. Resolve candidates via `fabric scope-explain team` (writable stores in the read-set); if more than one writable store exists, `AskUserQuestion` for the target store alias before persisting (header/question translate, the alias options stay English routing keys). Single writable store → use it. Persist through `fab_propose` with the chosen store; echo the target alias. Never write to a store the project did not declare (read-set bound).

## UX i18n Policy

Read `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`). Emit prose per variant. Protected tokens NEVER translate (`fab_propose`, `fab_review`, `.fabric/.import-state.json`, all enum strings, `MUST`/`NEVER`). Full 5-class taxonomy → `Read .../ref/i18n-policy.md`.

## 3-Phase Pipeline

Strict P1→P2→P3 order. State write after every sub-step. Infer-not-Ask.

### Phase 1 — Init-Scan Reference (NO RE-IMPLEMENT)

`fabric install` produced baseline. Phase 1 REFERENCES, does NOT redo.

1. Run `fabric onboard-coverage --json` and `fab_review action="search"` as needed to understand existing canonical titles in the mounted store read-set.
2. If no write store is resolved: STOP. Tell user `请先绑定并选择写入 store` / `Please bind and select a write store first` and exit.
3. Use the returned canonical titles for the P2 negative filter.
4. State: `phase=P1-done`, `p1_baseline_titles=[...]`, `last_checkpoint_at=<ISO>`.

No MCP calls.

### Phase 2 — LLM-Driven Mining

Classify each candidate into 5 types (decisions/pitfalls/guidelines/models/processes), draft slug, propose via `fab_propose`. Layer: `team`.

#### Mandatory Scope Rule — broad + empty paths (NON-NEGOTIABLE)

Every call MUST `relevance_scope="broad"` AND `relevance_paths=[]`. No exceptions. Why: import is LLM-driven (not session-driven); LLM-inferred narrow lies about applicability. Post-rc.37 A1 the server returns every selectable entry regardless of scope, so false-narrow no longer hides knowledge — but it still poisons doctor lint accounting + downstream consumers that read `relevance_paths` literally. Narrowing deferred to `fab_review.modify` post-import when the user has the real applicability surface. Full rationale + prohibitions + doctor lint #23 → `Read .../ref/phase-2-mining.md`.

#### Step 2.1 — Git Mining

`git log --since="<window> months ago" --pretty=format:"%H%n%s%n%b%n---ENDCOMMIT---" -n <cap>`. Conventional prefix → type signal (feat→decision/model, fix→pitfall, refactor→decision, docs→guideline; chore/test/ci skip). Extract observation → Skip Tree → `fab_propose` (broad+[]). Cap: `import_max_pending_per_run`.

#### Step 2.1.5 — Proposed Reason

Infer one of: `decision-confirmation` | `new-dependency-or-pattern` | `wrong-turn-revert` | `diagnostic-then-fix` | `explicit-user-mark` | `dismissal-with-reason`. Fallback: `new-dependency-or-pattern`. 11-row table → ref.

#### Step 2.2 — Docs Mining

`find docs/ -maxdepth 3 -name '*.md'` + root `*.md`. Skip README / CHANGELOG / LICENSE / CODE_OF_CONDUCT / CONTRIBUTING / <300B files. Same call shape. Shared cap.

#### Skip Decision Tree

Skip if: cosmetic-only / metadata-only / in baseline / not classifiable / slug not derivable to 2-5 kebab words.

#### Dry-Run

Explicit token `--dry-run` in invocation → skip MCP, render bilingual preview table (every Scope row `broad+[]`). State NOT written. P3 skipped. v2.0.0-rc.37 NEW-10 dropped legacy substring fallback on bare `dry-run` / `预览` (false-positive on incidental mentions).

Full MCP call shape, Step 2.1.5 table, dry-run templates, T5 idempotency → `Read .../ref/phase-2-mining.md`.

### Phase 3 — LLM-Driven Dedup

For each P2 pending: check vs canonical. Semantic compare is LLM's job — `fab_review` does NOT compare meaning.

1. **3.1** — `fab_review action="search"` filter by `type`, top 5.
2. **3.2** — Classify each pair: `duplicate` (reject pending) | `subsumption` (reject pending) | `subsumption-with-novelty` (modify canonical + reject pending) | `contradiction` (leave + flag) | `genuinely-new` (keep).
3. **3.3** — Issue `fab_review` reject / modify.
4. **3.4** — `phase=complete` + `final_summary` + roll-up.

Full call shapes + 5-way classification → `Read .../ref/phase-3-dedup.md`.

## Checkpoint Logic

State file `.fabric/.import-state.json` is single resumability source. Atomic write: Step A `Write .tmp` → Step B `Bash mv` (POSIX `rename(2)`). `Write` alone NOT atomic.

Resume contract: re-invoke MUST NOT dup-propose / re-dedup. By `phase`: `P1-done`→2.1, `P2-done`→3.1, `complete <24h`→skip, `≥24h`→confirm.

Full rationale + 4KB POSIX constraint + state schema + 6-step Resume → `Read .../ref/checkpoint-state.md`.

## Default Knobs

Layer `team` / scope `broad` / paths `[]` are contract-locked (no override). Max pending = config / dry-run via keyword / re-run <24h blocked. Full table → ref.

## Hard Rules

### DISPLAY (per entry)

`[type=...]` `[layer=team]` `[scope=broad]` `slug=...` `src=<sha7-or-path>` + `pending_path`. zh-CN body + EN headings. Roll-up: proposed / kept / rejected_dup / merged / contradictions_flagged. Final `phase` on exit. Never hide source / show `idempotency_key` / auto-classify `personal`.

### WRITE

NEVER write entry via `Edit`/`Write`/`Bash` — only `fab_propose` (P2) + `fab_review` (P3).

NEVER batch P2 candidates / skip P1 ref / call `fab_review.approve` / `git mv` directly / infer layer-flip / non-atomic state / exceed cap / `relevance_scope="narrow"` / non-empty `relevance_paths` / copy fabric-archive Phase 1.5 logic.

Narrowing post-import = `fab_review.modify` (out-of-band).

Protected tokens (verbatim, no translate): `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_proposed`, `fab_propose`, `fab_review`, `MUST`, `NEVER`, `phase`, `.import-state.json`, `relevance_scope`, `relevance_paths`, `broad`, `narrow`, `source_sessions`, `proposed_reason`, `session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`.

## Output Contract

Roll-up sections (per `fabric_language`): `Phase 2 — Mining` | `Phase 3 — Dedup` | `State` | `Next Steps`. Include the target store alias for proposed entries. Bilingual templates → `Read .../ref/output-contract.md`.

## Worked Examples

4 end-to-end (A feat→pitfall + WRONG counter-ex; B docs→decision; C P3 dup→reject; D out-of-band narrow) → `Read .../ref/worked-examples.md`.

## Failure Recovery

- P2 mid-fail: state has `p2_processed_commits[]`; rerun skips them.
- P3 mid-fail: state has `p3_dedup_completed[]`; rerun resumes.
- `errors.length > 5`: halt + ask `继续 (y) / 中止并保留 state (n)` / `Continue (y) / Abort and keep state (n)`.
- State corruption: P0 detects → rename `.json.corrupt-<ISO>` → restart P1.
- MCP unreachable: halt + `MCP 工具未注册；请检查 fabric server 是否运行` / `MCP tool not registered; please check that the fabric server is running` → exit without state write.

Resume policy: inspect existing state and continue from the last completed phase — do not prompt the user mid-flow.
