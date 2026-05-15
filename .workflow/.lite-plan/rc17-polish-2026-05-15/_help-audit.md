# rc.17 TASK-001 — `--help` Coverage Audit (read-only)

**Generated:** 2026-05-15
**Sources:**
- `packages/shared/src/i18n/locales/en.ts`
- `packages/shared/src/i18n/locales/zh-CN.ts`

**Scope:** Inventory every `cli.*.description` key, verify bilingual parity, flag
example/clarity/rc15-stale gaps. Output consumed by TASK-002 (`--help` rewrite).

---

## Summary

| Metric | Value |
|---|---|
| Total `cli.*.description` keys (en) | 68 |
| Total `cli.*.description` keys (zh-CN) | 68 |
| Bilingual parity (en ⇔ zh-CN) | **100%** — zero unmatched keys |
| Visible commands per rc.15 surface | 5 (`install`, `doctor`, `serve`, `uninstall`, `config`) |
| Hidden / internal command groups still in locales | `approve`, `bootstrap`, `hooks`, `human-lint`, `ledger-append`, `pre-commit`, `scan`, `update`, `sync-meta` |
| Root command (`cli.main.description`) carries example | ✗ (no 装/配/跑 mental-model intro) |
| Visible-command root descriptions carrying example | 0 / 5 |
| Argument descriptions carrying example | 4 / 47 (only `--clients` flags reference `claude,cursor,codex` / `cursor,codex`) |
| rc.15-stale flags (removed flags still mentioned) | **0** in description text — clean |

**Headline:** Parity is perfect — no bilingual gaps to backfill. The real work in
TASK-002 is **example injection** at the root + 5-visible-command level, plus a
3-line 装/配/跑 mental-model intro on `cli.main.description`. Hidden-command
descriptions (approve/bootstrap/hooks/...) are still surfaced when a user runs
`fab --help` (citty enumerates `subCommands` regardless of "visibility"); see
"Visibility caveat" at the bottom.

---

## Coverage Matrix — by command group

Legend:
- **en / zh** — `✓` present, `✗` missing
- **example** — `✓` description text contains a concrete example (e.g. flag value, command snippet, env var name); `✗` no example; `N/A` for boolean/trivial flags where an example would be noise
- **rc15-stale** — `✓` mentions a flag removed in rc.15; `✗` clean

### Group 0 — Root (1 key)

| Key | en | zh | example | rc15-stale | Notes |
|---|---|---|---|---|---|
| `cli.main.description` | ✓ | ✓ | ✗ | ✗ | One-liner only. **Missing 装/配/跑 mental-model intro and an `Examples:` block.** |

### Group A — `install` (visible, 4 keys)

| Key | en | zh | example | rc15-stale | Notes |
|---|---|---|---|---|---|
| `cli.install.description` | ✓ | ✓ | ✗ | ✗ | "Install Fabric in the target project." — terse, no example. Should add 1-2 line example block (`fab install`, `fab install --dry-run`). |
| `cli.install.args.target.description` | ✓ | ✓ | ✓ | ✗ | Mentions `EXTERNAL_FIXTURE_PATH`/`fabric.config.json`/cwd resolution chain. Note: `fabric.config.json` mention will become stale once rc.17 TASK-R drops `externalFixturePath`. **Coordinate with R-tasks.** |
| `cli.install.args.debug.description` | ✓ | ✓ | N/A | ✗ | Boolean flag, trivial. |
| `cli.install.args.yes.description` | ✓ | ✓ | N/A | ✗ | Boolean flag, OK as-is. |
| `cli.install.args.dry-run.description` | ✓ | ✓ | N/A | ✗ | Boolean flag, OK as-is. |

### Group B — `doctor` (visible, 7 keys)

| Key | en | zh | example | rc15-stale | Notes |
|---|---|---|---|---|---|
| `cli.doctor.description` | ✓ | ✓ | ✗ | ✗ | "Run Fabric target-state diagnostics." — too terse. Should mention what gets checked + add example (`fab doctor`, `fab doctor --fix`). |
| `cli.doctor.args.target.description` | ✓ | ✓ | ✓ | ✗ | Same resolution-chain caveat as install. |
| `cli.doctor.args.fix.description` | ✓ | ✓ | ✗ | ✗ | Long-ish ("meta, knowledge-test index, bootstrap, and events ledger"). Could tighten. |
| `cli.doctor.args.json.description` | ✓ | ✓ | N/A | ✗ | OK. |
| `cli.doctor.args.strict.description` | ✓ | ✓ | N/A | ✗ | OK. |
| `cli.doctor.args.fix-knowledge.description` | ✓ | ✓ | ✗ | ✗ | **Verbose** — mentions "demote orphaned canonical entries, archive stale drafts, and bump drifted index counters. Emits knowledge_demoted / knowledge_archived events. Default doctor invocation remains report-only." Candidate for tightening; the events-emitted detail belongs in long-form docs, not `--help`. |
| `cli.doctor.args.rescan.description` | ✓ | ✓ | ✗ | ✗ | Tight already. |
| `cli.doctor.args.yes.description` | ✓ | ✓ | ✓ | ✗ | Mentions `FABRIC_NONINTERACTIVE=1` env var — good actionable example. |

### Group C — `serve` (visible, 5 keys)

| Key | en | zh | example | rc15-stale | Notes |
|---|---|---|---|---|---|
| `cli.serve.description` | ✓ | ✓ | ✓ | ✗ | Mentions `FABRIC_AUTH_TOKEN`. **Cross-link to S-task** (`serve --host` warning audit, rc.17 task) — this description and `args.host.description` overlap. |
| `cli.serve.args.port.description` | ✓ | ✓ | ✓ | ✗ | Default 7373 is named — implicit example. |
| `cli.serve.args.host.description` | ✓ | ✓ | ✓ | ✗ | Mentions `FABRIC_AUTH_TOKEN` + `127.0.0.1` default. **Duplicates the warning info from `cli.serve.description`** — candidate for tightening (move auth-token guidance to a single canonical location). |
| `cli.serve.args.target.description` | ✓ | ✓ | ✓ | ✗ | Same resolution-chain caveat. |
| `cli.serve.args.debug.description` | ✓ | ✓ | N/A | ✗ | OK. |

### Group D — `uninstall` (visible, 5 keys)

| Key | en | zh | example | rc15-stale | Notes |
|---|---|---|---|---|---|
| `cli.uninstall.description` | ✓ | ✓ | ✗ | ✗ | "Uninstall Fabric from the target project." — terse, no example. Should add `fab uninstall --dry-run` example and the **knowledge-preservation guarantee** (currently buried in `cli.uninstall.plan.preserves.knowledge` and `wizard.overview.body`). |
| `cli.uninstall.args.target.description` | ✓ | ✓ | ✓ | ✗ | Same resolution-chain caveat. |
| `cli.uninstall.args.debug.description` | ✓ | ✓ | N/A | ✗ | OK. |
| `cli.uninstall.args.yes.description` | ✓ | ✓ | N/A | ✗ | OK. |
| `cli.uninstall.args.dry-run.description` | ✓ | ✓ | N/A | ✗ | OK. |

### Group E — `config` (visible, 5 keys + 11 panel-field descriptions)

#### Top-level

| Key | en | zh | example | rc15-stale | Notes |
|---|---|---|---|---|---|
| `cli.config.description` | ✓ | ✓ | ✗ | ✗ | "Manage Fabric MCP client configuration." — **stale framing.** Since rc.16 TASK-006, `fab config` is the interactive 11-field panel (audit_mode, fabric_language, etc.) — not just MCP client wiring. Description should be rewritten to cover the panel + scope. |
| `cli.config.args.target.description` | ✓ | ✓ | ✗ | ✗ | OK ("defaults to cwd"). |
| `cli.config.install.description` | ✓ | ✓ | ✗ | ✗ | Subcommand `fab config install` — describes MCP-server-entry install. **Verify:** is this still a reachable subcommand after rc.16 turned `fab config` into a clack panel? If `fab config install` was collapsed, this key is dead code. |
| `cli.config.install.args.clients.description` | ✓ | ✓ | ✓ | ✗ | Mentions `cursor,codex` example — good. |
| `cli.config.install.args.dry-run.description` | ✓ | ✓ | N/A | ✗ | OK. |

#### `config.fields.*.description` (rc.16 panel field labels — 11 keys)

These are surfaced inside the clack interactive panel (not on `--help`), so
"example present in description" is less critical. They MUST be tight, plain
language. All 11 have parity.

| Key | en | zh | clarity | Notes |
|---|---|---|---|---|
| `cli.config.fields.fabric_language.description` | ✓ | ✓ | OK | "Language used by Fabric hooks and Skills output." |
| `cli.config.fields.default_layer_filter.description` | ✓ | ✓ | OK | Names enum values (`team / personal / both`). |
| `cli.config.fields.archive_hint_hours.description` | ✓ | ✓ | OK | Names "Signal A" — Fabric jargon, OK in panel context. |
| `cli.config.fields.archive_hint_cooldown_hours.description` | ✓ | ✓ | OK | |
| `cli.config.fields.archive_edit_threshold.description` | ✓ | ✓ | OK | |
| `cli.config.fields.underseed_node_threshold.description` | ✓ | ✓ | OK | |
| `cli.config.fields.review_hint_pending_count.description` | ✓ | ✓ | OK | |
| `cli.config.fields.review_hint_pending_age_days.description` | ✓ | ✓ | OK | |
| `cli.config.fields.maintenance_hint_days.description` | ✓ | ✓ | OK | |
| `cli.config.fields.maintenance_hint_cooldown_days.description` | ✓ | ✓ | OK | |
| `cli.config.fields.audit_mode.description` | ✓ | ✓ | OK | Names enum values (`strict / warn / off`). |

### Group F — Hidden / internal commands (not in 5-visible surface)

These commands are **registered nowhere in `packages/cli/src/commands/index.ts`**
(verified 2026-05-15: `allCommands` exports only `install / doctor / serve /
uninstall / config / plan-context-hint`), so their `cli.<group>.*.description`
keys are **dead i18n** — the strings are loaded but never rendered as `--help`
text by citty.

> **Decision input for TASK-002 / future:** Either delete these keys (clean-slate
> per memory `feedback_clean_slate.md`) or keep them as forward-compat for
> programmatic use (e.g. fabric-server still calls these as APIs?). Recommend
> **delete in a follow-up** and note here for visibility.

| Group | Description root key | en | zh | Notes |
|---|---|---|---|---|
| `approve` | `cli.approve.description` (+ 3 args) | ✓ | ✓ | Not in `allCommands` — dead. |
| `bootstrap` | `cli.bootstrap.description` (+ subcmd `install` + 1 arg) | ✓ | ✓ | Not in `allCommands` — dead. |
| `hooks` | `cli.hooks.description` (+ subcmd `install` + 1 arg) | ✓ | ✓ | Not in `allCommands` — dead. |
| `human-lint` | `cli.human-lint.description` (+ 1 arg) | ✓ | ✓ | Not in `allCommands` — dead. |
| `ledger-append` | `cli.ledger-append.description` (+ 2 args) | ✓ | ✓ | Not in `allCommands` — dead. |
| `pre-commit` | `cli.pre-commit.description` (+ 1 arg) | ✓ | ✓ | Not in `allCommands` — dead. |
| `scan` | `cli.scan.description` (+ 3 args) | ✓ | ✓ | Not in `allCommands` — dead. |
| `update` | `cli.update.description` (+ 3 args) | ✓ | ✓ | Not in `allCommands` — dead. |
| `sync-meta` | `cli.sync-meta.description` (+ 2 args) | ✓ | ✓ | Not in `allCommands` — dead. |

### Group G — Shared (`cli.shared.*`)

`cli.shared.*` has no `*.description` keys (only labels like `created`, `error`,
`yes`, `no`, etc.). **N/A for this audit.** All 18 shared keys exist in both
locales (visually verified at en.ts:5-22 and zh-CN.ts:5-22).

---

## Bilingual parity check

```bash
$ diff <(grep -oE '"cli\.[^"]+\.description"' en.ts | sort -u) \
       <(grep -oE '"cli\.[^"]+\.description"' zh-CN.ts | sort -u)
# (no output — perfect parity)
```

**Result:** Zero unmatched `cli.*.description` keys between en and zh-CN. No
parity-fix work for TASK-002.

---

## rc.15-stale flag check

Searched all 68 description bodies for references to flags removed in rc.15
(per `memory/project_grill_deferred_items.md` Phase 2 — "CLI surface
contraction"). Specifically scanned for legacy `apply-lint` mode (renamed to
`fix-knowledge` in commit `cf64a6b`) and any `--force` / `--no-confirm` style
flags.

**Result:** No description text references removed flags. (The recent rename
`apply-lint` → `fix-knowledge` already propagated to `cli.doctor.args.fix-knowledge.description`.)

---

## Recommendations for TASK-002

### 1. Bilingual gaps (must add)
**None.** Parity is perfect. No backfill required.

### 2. Keys lacking examples (where examples would clarify)

Priority order — focus on the user-facing 5-visible-command surface first:

**P0 (root + 5 visible commands):**
1. `cli.main.description` — add 装/配/跑 mental-model intro + Examples block (see §4 below).
2. `cli.install.description` — add 1-line example: `Examples: fab install` / `fab install --dry-run`.
3. `cli.doctor.description` — add 1-line example: `Examples: fab doctor` / `fab doctor --fix` / `fab doctor --fix-knowledge`.
4. `cli.uninstall.description` — add 1-line example AND mention `.fabric/knowledge/` is preserved.
5. `cli.config.description` — **rewrite** to cover the rc.16 interactive panel (not just MCP wiring). Add example: `fab config` (interactive panel) / `fab config --target /path`.

**P1 (already-good visible-command args, no change needed):**
- `cli.serve.description` — already mentions `FABRIC_AUTH_TOKEN` ✓
- `cli.doctor.args.yes.description` — already mentions `FABRIC_NONINTERACTIVE=1` ✓
- `cli.serve.args.port.description` — implicit example via "default 7373" ✓
- `cli.config.install.args.clients.description` — has `cursor,codex` example ✓

### 3. Keys with verbose/redundant text (candidates for tightening)

**P0:**
1. `cli.doctor.args.fix-knowledge.description` (en.ts:131-132 / zh-CN.ts:129-130) — strip the events-emitted detail (`knowledge_demoted / knowledge_archived`), keep the **what** and the report-only safety promise. Long-form belongs in `fab doctor --help-extended` or docs.
2. `cli.serve.description` ↔ `cli.serve.args.host.description` — both repeat the FABRIC_AUTH_TOKEN auth-token caveat. **Pick one canonical home** (recommend `args.host.description` since the warning fires on the host flag) and shorten the other.
3. `cli.doctor.args.fix.description` — list of 4 things ("meta, knowledge-test index, bootstrap, and events ledger") could be condensed to "derived Fabric state (meta + indexes)".

**P1:**
4. `cli.install.args.target.description` (and the 4 other `args.target.description` keys with the resolution chain) — the chain `CLI arg → EXTERNAL_FIXTURE_PATH → fabric.config.json → cwd` is repeated 5 times. **Cross-link to TASK-R** (rc.17): once `fabric.config.json#externalFixturePath` is dropped, all 5 of these need a coordinated rewrite to `CLI arg → EXTERNAL_FIXTURE_PATH → cwd`. **TASK-002 should leave these alone if TASK-R has not yet landed**, otherwise they will conflict.

### 4. Suggested 装/配/跑 mental-model intro (3 lines, bilingual)

Append below the existing `cli.main.description` (or replace it) so that
`fab --help` opens with the canonical mental model:

**en (`cli.main.description`):**
```
Fabric CLI — AI agent collaboration framework.

Three-step mental model:
  装 (install) — fab install   one-shot project setup
  配 (config)  — fab config    interactive configuration panel
  跑 (run)     — fab serve     launch the local MCP HTTP service
                fab doctor     run target-state diagnostics

Examples:
  fab install                  install Fabric in the current project
  fab config                   open the interactive configuration panel
  fab serve --port 7373        start the MCP HTTP service
  fab doctor --fix             repair derived Fabric state
  fab uninstall --dry-run      preview uninstall without removing files
```

**zh-CN (`cli.main.description`):**
```
Fabric CLI — AI 智能体协作框架。

三步心智模型：
  装 (install) — fab install   一键完成项目初始化
  配 (config)  — fab config    打开交互式配置面板
  跑 (run)     — fab serve     启动本地 MCP HTTP 服务
                fab doctor     运行目标态诊断

示例：
  fab install                  在当前项目中安装 Fabric
  fab config                   打开交互式配置面板
  fab serve --port 7373        启动 MCP HTTP 服务
  fab doctor --fix             修复 Fabric 派生状态
  fab uninstall --dry-run      预览卸载，不删除文件
```

> Implementation note for TASK-002: citty's `defineCommand({ meta })` only
> renders `description` (not `examples`) in the default help template. Either
> embed the examples block in the description string (multiline strings in
> citty are preserved) OR introduce a `meta.examples` extension and render
> manually. The simpler clean-slate option is **embed in `description`** since
> it keeps the i18n key surface unchanged.

### 5. Cross-task coordination flags

| Issue | Affected keys | Coordinate with |
|---|---|---|
| `fabric.config.json#externalFixturePath` going away | 5 × `cli.<command>.args.target.description` | rc.17 TASK-R (resolution chain consolidation) |
| `cli.serve.description` ↔ `args.host.description` overlap | 2 keys | rc.17 TASK-S (`serve --host` warning audit) |
| 9 hidden command groups have dead i18n keys | ~22 keys total under `approve / bootstrap / hooks / human-lint / ledger-append / pre-commit / scan / update / sync-meta` | **Defer to a follow-up cleanup task** (out of scope for TASK-002). |
| `cli.config.install.*` keys may be dead post-rc.16 | 3 keys | **Verify** with rc.16 TASK-006 author whether `fab config install` is still a reachable subcommand. If collapsed, delete. |

---

## Visibility caveat (informational)

`packages/cli/src/commands/index.ts` only registers 6 sub-commands (5 visible +
`plan-context-hint`). The 9 hidden command groups (`approve`, `bootstrap`,
`hooks`, `human-lint`, `ledger-append`, `pre-commit`, `scan`, `update`,
`sync-meta`) have full i18n description keys but **no citty registration**, so
they don't appear in `fab --help`. The keys are loaded into the message catalog
but unreachable through the CLI surface.

This is consistent with rc.15 surface contraction — removed CLI entries kept
their i18n strings as dead weight. **Recommend filing a separate cleanup task
post-TASK-002** to either (a) delete the dead description keys or (b) re-expose
the hidden commands behind a `fab --advanced` flag if any are still needed for
power-user workflows.

---

## File: end of audit
