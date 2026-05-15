# rc.16 Planning Context — Config + i18n closure

## Scope (from memory/project_grill_deferred_items.md Phase 3)

**Mandatory order**: F2 must precede F1 (panel has no value without responsive hooks).

### F2 — Banner i18n
- 5 banner blocks in `packages/cli/templates/hooks/fabric-hint.cjs`:
  - Line 614 (Signal A — archive hint): `📋 Fabric: 距上次归档 ${parts.join(" / ")}。`
  - Line 619-621 (Signal A activity + cta): `   最近活动集中在: ${activity}。\n   是否调 /fabric-archive ...`
  - Line 651-652 (Signal B — review hint): `📋 Fabric: 已积累 ${stats.count} 条待审核知识 ...\n   是否调 /fabric-review ...`
  - Line 697-698 (Signal C — underseed): `📋 Fabric: 知识库节点数 ... \n   是否调 /fabric-import ...`
  - Line 929-932 (Signal D — lint maintenance): `   是否调 \`fabric doctor --lint\` ... \n📋 Fabric: 从未运行 lint 检查` / `已 N 天未跑 lint 检查`
- 1 banner block in `packages/cli/templates/hooks/knowledge-hint-broad.cjs`:
  - Line 263: `  📋 Fabric: 知识库稀疏，是否调 /fabric-import ...`

### F1 — `fab config` clack TUI panel
- Replaces rc.15 placeholder at `packages/cli/src/commands/config.ts`
- Loop shape: select field → show current value → edit → write → re-render
- Scope = schema Group A + B + C in `packages/shared/src/schemas/fabric-config.ts`:
  - Group A (Locale): `fabric_language`, `default_layer_filter`
  - Group B (8 hint thresholds): `archive_hint_hours`, `archive_hint_cooldown_hours`, `underseed_node_threshold`, `review_hint_pending_count`, `review_hint_pending_age_days`, `maintenance_hint_days`, `maintenance_hint_cooldown_days` (verify count — currently 7 in schema; user spec said 8 — task may need to confirm or add)
- Top-level CLI flag: only `--target`
- Uninit workspace → error + hint to `fab install`
- Atomic write, no lock check
- Group D (skill-internal tuning, 10 keys) + Group E (plumbing, 5 keys): NOT in panel

## Existing patterns (to reuse)

### i18n in .cjs hooks (currently absent)
- `packages/cli/src/i18n.ts` (TS side) uses `createTranslator(detectNodeLocale())` — NOT directly reusable in .cjs hook scripts
- Hooks already read `.fabric/fabric-config.json` for thresholds (e.g. `fabric-hint.cjs:83 CONFIG_FILE`, `knowledge-hint-broad.cjs:74 FABRIC_CONFIG_FILE`)
- Pattern: extend the existing config-read helpers to also return `fabric_language`, then a lookup table of zh-CN/en/zh-CN-hybrid/match-existing variants
- `match-existing` and unknown values default to `en` per the project's UX i18n Policy class 1 rendering rule
- `zh-CN-hybrid` for banner copy: emit Chinese narrative with English protected tokens (slash command names like `/fabric-archive`, file paths) preserved verbatim

### clack TUI patterns (to mirror)
- `packages/cli/src/commands/install.ts` — uses `select`, `confirm`, `intro`, `outro`, `group`, `log`, `note`, `cancel`, `isCancel`
- `packages/cli/src/commands/uninstall.ts` — same import shape, uses `group()` for multi-step wizard
- `packages/cli/src/commands/doctor.ts` — uses `confirm`, `isCancel` (lighter prompt)

### Schema source of truth
- `packages/shared/src/schemas/fabric-config.ts` — Zod schema with defaults; F1 panel will introspect this to render labels + current values + validate edits

## Cross-phase constraints

- Each task = one git commit (per memory/project_grill_deferred_items.md)
- pre-user clean-slate: no migration shim (per memory/feedback_clean_slate.md)
- drift→abort, no `--force` (per memory/feedback_cli_design.md)
- Run Gemini review + coverage ONCE at end of plan, not per-task (per memory/feedback_review_batching.md)
- F2 commits MUST land before F1 commits (panel UX depends on i18n hooks rendering correctly)

## Anti-scope (DO NOT do in rc.16)

- Group D / Group E config keys in panel (power users edit JSON)
- `fab config` subcommands (rc.15 deleted them)
- Lock check on config write (atomic write only)
- v1 schema compatibility shim
- Multi-flag CLI surface for `fab config` (only `--target`)
