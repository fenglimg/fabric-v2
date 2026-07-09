# Release Notes

Fabric release notes for changes needing user-visible migration guidance.
Per-rc detail lives in `CHANGELOG.md`; this file explains the "what changed
for me?" for behavior shifts that touch defaults or user workflows.

---

## nudge_mode 默认 silent（新装用户）

**Traceability**: `GRL-STOPHOOK-AIONLY-20260709` (grill 决策链)

**Breaking behavior change (opt-in ergonomic revert)** — the human-facing
Stop hook `systemMessage` breadcrumb is now MUTED by default on new installs.
The AI channel (`additionalContext`) is unchanged; the model still receives
knowledge context on every hook fire.

### 1. Change scope（变更范围）

- **Only new installs**: `fabric install` now scaffolds
  `.fabric/fabric-config.json` with `nudge_mode: "silent"` instead of the
  previous `"normal"`.
- **Old installs (existing `nudge_mode` field)**: no change. Your value is
  respected exactly as-is.
- **Old installs (config lacks `nudge_mode`)**: no change. The runtime
  fallback stays at `"normal"` (visible) — silent-default doesn't reach
  in-place users unless they explicitly opt in.

### 2. Zero-action recovery paths（老用户零迁移）

Nothing to do. The Stop hook cadence you saw before rc.X still fires exactly
the same way. Only NEW installs experience the AI-only default.

### 3. Restore visibility — three paths（恢复可见 3 路径）

If you're on a new install and want the human breadcrumb back, pick the
scope that fits your workflow:

| Scope | How | Effect |
|-------|-----|--------|
| Per-repo | Edit `.fabric/fabric-config.json`, set `"nudge_mode": "normal"` (or `"verbose"`) | This repo only |
| Machine-wide | Create `~/.fabric/fabric-global.json` with `{"nudge_mode": "normal"}` | All repos on this machine (unless per-repo overrides) |
| Session-only | Export `FABRIC_NUDGE_MODE=normal` in your shell | This shell / process tree only |

The 4-layer priority order (highest → lowest):

```
env FABRIC_NUDGE_MODE  >  project .fabric/fabric-config.json
                       >  global ~/.fabric/fabric-global.json
                       >  default "normal"
```

### 4. Observability entry（观测入口）

Since the human channel defaults to silent, use `fabric doctor` to see the
backlog you would previously have been nudged about. The command now emits
a neutral metric line at the end of the report:

```
  backlog: N high-value, oldest Xd
```

where `N` = pending high-value archive candidates across all sessions, and
`X` = age in days of the oldest candidate. `N=0` renders as `backlog: 0
high-value` (no age suffix).

The metric is PURE OBSERVABILITY — it does not affect the doctor exit code,
carry a lint severity, or block CI. It is safe to grep in scripts.

### 5. Rollback baseline — `.fabric/metrics.jsonl`

Every doctor run also appends one line to `.fabric/metrics.jsonl`:

```json
{"ts":"2026-07-09T16:00:00.000Z","kind":"backlog","count":2,"median_age_days":2}
```

Use this 4-week time series to judge whether silent-default is losing you
knowledge. Rollback threshold: if `median_age_days` sustains > 1.5× the
first-week baseline for 2+ consecutive weeks, flip
`FABRIC_NUDGE_MODE=normal` (or set the field explicitly in your config).

The file is gitignored, append-only, and safe to delete at any time
(doctor recreates it on the next run).

---

## rc/GA changelog

For per-release feature/fix detail (rc.x → GA / current version bumps),
see `CHANGELOG.md` at the repo root.
