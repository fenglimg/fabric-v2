# Issue Discovery Report

## Summary
- Session: DBP-20260609-033400
- Mode: by-prompt live-state sweep
- Raw findings: 9
- Unique issues appended: 6
- Severity: critical=0, high=0, medium=2, low=4

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| dirty-worktree-contracts | 已读取 existing registry，重点核对 ISS-20260609-001..059；读取 dirty-files.txt 与 fabric-doctor.txt，并用 git status/diff/ls-files 交叉确认。dirty-files.txt 仅列 .workflow/issues/issues.jsonl，当前 packages/cli 与 packages/shared 范围内无未提交 modified/staged/untracked product 文件，因此没有可落到 product file:line 的新增 contract/schema/snapshot/i18n/parity inconsistency。 | {"critical":0,"high":0,"medium":0,"low":0} |
| doctor-warning-issues | 已扫 existing registry（含 ISS-20260609-001..059）、fabric-doctor.txt、dirty-files、packages/docs/.claude/.codex 范围。新增 3 个低危：SKILL description lint 的 CRLF false positive、retired archive-hint orphan hook 造成不可修复 parity warning、fabric-archive canonical SKILL 超过 doctor token budget。跳过 events ledger/KB summary/store scope 等本机维护或已登记根因。 | {"critical":0,"high":0,"medium":0,"low":3} |
| installed-vs-template-drift | 扫过 existing registry ISS-20260609-001..059、doctor 证据、.claude/.codex hooks/skills、hook config 模板、bootstrap canonical 与安装测试。新增 3 个未登记漂移：AGENTS managed block 仍是旧 agents.meta 文案；遗留 archive-hint.cjs 文件仍安装在两端且内容互相漂移；当前 Codex PreToolUse 顺序与模板相反而测试只做包含断言。 | {"critical":0,"high":0,"medium":1,"low":2} |
| knowledge-store-health-tail | 已读 registry 并避开 ISS-20260609-001..059 中的 store routing、alias traversal、metric G11 等已登记根因；扫描 doctor 输出、store scope lint、by-alias、events/metrics、maturity/summary 相关代码。新增 2 个 health-tail 问题：visibility_store 校验缺口与 by-alias symlink 不可用时的永久告警。 | {"critical":0,"high":0,"medium":1,"low":1} |
| registry-artifact-integrity | 已读 existing registry 并排除 ISS-20260608-047 的 source-mix 与 ISS-20260609-050 的 history root cause；扫描 .workflow/issues JSON/JSONL、discovery-state/discovery-issues、packages 范围引用。新增 1 个 artifact integrity 问题：discovery index 未登记任何已完成 DBP 多轮发现。dirty-files.txt/fabric-doctor.txt 未在工作树找到。 | {"critical":0,"high":0,"medium":1,"low":0} |

## Issues Created
- ISS-20260609-060 [low] Doctor skill description lint treats CRLF SKILL frontmatter as missing — packages/server/src/services/doctor.ts:2646; packages/cli/templates/skills/fabric-archive/SKILL.md:1
- ISS-20260609-061 [low] Legacy archive-hint.cjs files remain under installed hook trees after the fabric-hint rename — .claude/hooks/archive-hint.cjs:1; .codex/hooks/archive-hint.cjs:1; packages/cli/src/install/skills-and-hooks.ts:1588; packages/cli/src/install/skills-and-hooks.ts:1716; packages/cli/__tests__/integration/install-skills-and-hooks.test.ts:490
- ISS-20260609-062 [low] Canonical fabric-archive SKILL exceeds the doctor hot-path token budget — packages/cli/templates/skills/fabric-archive/SKILL.md:1; .claude/skills/fabric-archive/SKILL.md:1; .codex/skills/fabric-archive/SKILL.md:1
- ISS-20260609-063 [medium] Store scope lint never verifies visibility_store matches the physical holding store — packages/server/src/services/doctor-scope-lint.ts:130
- ISS-20260609-064 [low] by-alias best-effort symlink failures turn into permanent doctor drift warnings — packages/cli/src/store/store-ops.ts:101
- ISS-20260609-065 [medium] Discovery catalog index omits every completed DBP discovery run — .workflow/issues/discoveries/index.json:2

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-live-state-033400/results.csv
- .workflow/issues/discoveries/DBP-20260609-033400/discovery-issues.jsonl
