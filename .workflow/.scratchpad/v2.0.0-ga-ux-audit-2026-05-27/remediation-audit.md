# Doctor remediation copy audit (rc.37 NEW-8)

**Date**: 2026-05-28
**Scope**: every `doctor.check.*.remediation*` + `*.actionHint` string, both locales (zh-CN + en).
**Method**: programmatic scan of `zhCNMessages` / `enMessages` via the live translator + manual review of flagged entries.

## 1. Verdict

- **Destructive guidance: 0.** No remediation recommends deleting the event ledger (`events.jsonl`), the `.fabric` root, or canonical knowledge `.md` entries. The GA audit's P0 concern ("引导删 ledger / 删 .fabric/") does **not** reproduce in the current copy.
- The only "delete" instruction targets a **regenerable derived cache** (`.fabric/.cache/knowledge-test.index.json`) — losing no source-of-truth data; this is the documented recovery for a corrupt index and is explicitly allowed.
- The `agents_meta` remediation is exemplary: it *forbids* manual deletion inline ("do NOT manually delete agents.meta.json — you would lose counters envelope and promote-ledger associations").
- `event_ledger_partial_write` uses `--fix` to **truncate-and-preserve** corrupted bytes, never blind-delete.

## 2. Permanent guardrail

A regression test now bars destructive remediation copy:
`packages/shared/test/api-contracts.test.ts` → "doctor remediation destructive-guidance guard (rc.37 NEW-8)".
It scans both locales for ledger deletion / `rm -rf .fabric` (non-cache) / knowledge-tree wipe / canonical-entry deletion and fails the build if any future string regresses. `.fabric/.cache/*` deletions are carved out.

## 3. Structure review (diagnosis + command + manual fallback)

54 remediation strings reviewed. Findings:

| Class | Count | Notes |
|---|---|---|
| `fabric doctor --fix` auto-fix path | majority | Diagnosis in `.message`, command = `--fix`. Manual fallback = the skill/CLI surfaces. |
| Skill-routed (`/fabric-review`, `/fabric-archive`) | several | Command = the skill; manual fallback = direct frontmatter edit. |
| Inherently-manual (no fabric command applies) | 4 | `event_ledger.not_writable` (fix file permissions), `skill_md_yaml_invalid` (quote the YAML value), `baseline_filename_format` (`rm <listed stale baseline file>`), `narrow_no_paths`. These ARE the manual fallback — no auto-fix is safe/possible. |

**Spot-fix applied**: `narrow_no_paths.remediation` previously gave only an abstract instruction ("add anchors or widen scope"). Updated (both locales) to name the concrete command (`/fabric-review` → modify) plus the direct-edit fallback.

The remaining "no fabric-command" entries are correct as-is: they are permission / syntax / stale-file conditions where a manual action *is* the appropriate and only safe remedy.

## 4. Scan reproduction

```
node -e '<translator scan>'  # see commit rc37 NEW-8 for the inline script
# scanned 54 | danger=0 (2 false positives: "wiped" defensive advice, cache-index delete) | manual-only=4
```
