# Issue Discovery Report

## Summary
- Session: DBP-20260609-035800
- Mode: by-prompt dry-confirm sweep
- Raw findings: 1
- Unique issues appended: 1
- Severity: critical=0, high=0, medium=1, low=0

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| cli-shared-dry | 已读取 ISS-20260609-001..067，并用 rg 扫描指定 CLI/shared/docs/root 文件范围。候选命中均与既有 registry root cause 重复：dry-run 写入、unknown flags、CLI surface/help drift、store-only 旧路径、MCP surface、related/store resolver、Windows/symlink 等；未确认完全不同的新 file:line root cause。 | {"critical":0,"high":0,"medium":0,"low":0} |
| server-store-dry | []。已读取 ISS-20260609-001..067，并按 server/store/doctor/review/recall/events/metrics 范围用 rg 扫描。命中项均归入既有根因：store-only/doctor drift、write-target 重解析、pending layer flip Windows 判断、related/redirect、scope lint、search include_rejected、store symlink、metrics 全局窗口等；未确认完全不同的新 root cause。 | {} |
| artifacts-ci-skills-dry | Found 1 new non-duplicate root cause: the CI protected-token lint still requires retired store-only-era tokens, so cleanup of skill/bootstrap wording would fail the gate. Other scanned hits matched ISS-001..067. | {"medium":1} |

## Issues Created
- ISS-20260609-068 [medium] Protected-token lint enforces retired project-local knowledge tokens — scripts/lint-protected-tokens.ts:38; scripts/lint-protected-tokens.ts:86; .github/workflows/ci.yml:49; .github/workflows/release.yml:49

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-dry-confirm-035800/results.csv
- .workflow/issues/discoveries/DBP-20260609-035800/discovery-issues.jsonl
