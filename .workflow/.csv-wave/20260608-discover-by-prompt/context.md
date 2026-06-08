# Issue Discovery Report

## Summary
- Session: DBP-20260608-214158
- Mode: by-prompt
- Perspectives: 4
- Raw findings: 15
- Unique issues: 14

## Breakdown by Perspective
| Perspective | Findings | Critical | High | Medium | Low |
|-------------|----------|----------|------|--------|-----|
| legacy-implementation-drift | 4 | 0 | 2 | 2 | 0 |
| command-surface-doc-drift | 3 | 0 | 2 | 1 | 0 |
| compat-layer-staleness | 4 | 0 | 2 | 2 | 0 |
| example-test-fixture-drift | 4 | 0 | 2 | 2 | 0 |

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 7 |
| Medium | 7 |
| Low | 0 |

## Perspective Details
### legacy-implementation-drift
发现 4 处明确的版本演进漂移：主线已切到 stdio + `fab_recall`/`fab_get_knowledge_sections`，但 getting-started、test-seed、architecture landscape 与 shared locale 仍传播 `fab_get_rule_sections`、`fabric serve` 和已删除的 server 服务，容易误导用户、测试生成与维护判断。

Top issues:
- ISS-20260608-002 Test seeds still encode quarantined serve/REST surfaces as active mainline intent (docs/test-seed/README.md:7)
- ISS-20260608-003 Codebase landscape points maintainers at deleted mainline server services (docs/CODEBASE_LANDSCAPE.md:86)
- ISS-20260608-004 Shared CLI locale strings still advertise removed `fabric serve` help text (packages/shared/src/i18n/locales/en.ts:8)
### command-surface-doc-drift
发现 3 个有明确证据的命令面文档漂移：README / surfaces / landscape 仍把 `init`、`scan`、`hooks install` 当成现行 CLI；MCP 合同与架构文档仍引用已删除的 `fab_get_rule_sections` / `get-rules.ts`；test seed / testing 文档继续把已退休的 `scan` / `serve` 当成校验基线，和当前命令注册表脱节。

Top issues:
- ISS-20260608-005 Quick start and CLI surface docs still point to removed `init` / `scan` / `hooks install` commands (README.md:199)
- ISS-20260608-006 MCP architecture and contract docs still describe deleted `fab_get_rule_sections` / `get-rules.ts` surfaces (docs/mcp-contracts.md:21)
- ISS-20260608-007 Test-seed and testing docs still validate a retired CLI surface (`scan` / `serve`, six-command registry) (docs/test-seed/cli.md:78)
### compat-layer-staleness
发现 4 个兼容层陈旧问题：主文档仍教授已移除的 `fab_get_rule_sections`/section-based 流程；知识类型文档仍使用旧成熟度 `endorsed/stable` 和旧命令 `--apply-lint`；CLI README 继续暴露已 quarantine 的 `fabric serve`；bootstrap/quickstart 仍把 `doctor --fix` 说成 pending 审核入口，和当前 `--fix`/`--fix-knowledge` 语义冲突。

Top issues:
- ISS-20260608-008 Getting-started docs still teach the retired `fab_get_rule_sections` flow (docs/getting-started.md:92)
- ISS-20260608-009 Knowledge lifecycle docs still publish pre-migration maturity names and doctor flag (docs/knowledge-types.md:23)
- ISS-20260608-010 CLI README still advertises the removed `fabric serve` command as the quickstart path (packages/cli/README.md:10)
### example-test-fixture-drift
发现 4 个有明确 file:line 证据的示例/测试种子漂移问题：CLI 与 server 的 test-seed 仍描述已 quarantine 的 HTTP/serve 面；初始化文档仍安装旧的 `archive-hint.cjs`；`surfaces.md` 这个“source of truth” 仍把 `scan` / `hooks install` 当作现行 CLI 示例。

Top issues:
- ISS-20260608-012 Server test seed still documents quarantined HTTP server contract (docs/test-seed/server.md:9)
- ISS-20260608-013 CLI test seed still treats `fabric serve` as current command surface (docs/test-seed/cli.md:9)
- ISS-20260608-014 Initialization guide still installs legacy `archive-hint.cjs` (docs/initialization.md:108)

## Issues Created
- ISS-20260608-002 | high | Test seeds still encode quarantined serve/REST surfaces as active mainline intent | docs/test-seed/README.md:7
- ISS-20260608-003 | medium | Codebase landscape points maintainers at deleted mainline server services | docs/CODEBASE_LANDSCAPE.md:86
- ISS-20260608-004 | medium | Shared CLI locale strings still advertise removed `fabric serve` help text | packages/shared/src/i18n/locales/en.ts:8
- ISS-20260608-005 | high | Quick start and CLI surface docs still point to removed `init` / `scan` / `hooks install` commands | README.md:199
- ISS-20260608-006 | high | MCP architecture and contract docs still describe deleted `fab_get_rule_sections` / `get-rules.ts` surfaces | docs/mcp-contracts.md:21
- ISS-20260608-007 | medium | Test-seed and testing docs still validate a retired CLI surface (`scan` / `serve`, six-command registry) | docs/test-seed/cli.md:78
- ISS-20260608-008 | high | Getting-started docs still teach the retired `fab_get_rule_sections` flow | docs/getting-started.md:92
- ISS-20260608-009 | medium | Knowledge lifecycle docs still publish pre-migration maturity names and doctor flag | docs/knowledge-types.md:23
- ISS-20260608-010 | high | CLI README still advertises the removed `fabric serve` command as the quickstart path | packages/cli/README.md:10
- ISS-20260608-011 | medium | Canonical bootstrap still tells users to use `doctor --fix` for pending-entry review | packages/shared/src/templates/bootstrap-canonical.ts:84
- ISS-20260608-012 | high | Server test seed still documents quarantined HTTP server contract | docs/test-seed/server.md:9
- ISS-20260608-013 | high | CLI test seed still treats `fabric serve` as current command surface | docs/test-seed/cli.md:9
- ISS-20260608-014 | medium | Initialization guide still installs legacy `archive-hint.cjs` | docs/initialization.md:108
- ISS-20260608-015 | medium | `surfaces.md` marked as source of truth still teaches removed CLI commands | docs/surfaces.md:24
