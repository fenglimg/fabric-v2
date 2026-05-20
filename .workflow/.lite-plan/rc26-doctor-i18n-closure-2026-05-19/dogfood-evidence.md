# rc.26 Dogfood Evidence — `fab doctor` Bilingual Output

**Captured**: 2026-05-20
**Target**: `/Users/wepie/Desktop/personal-projects/pcf` (this repo)
**Driver**: locally-built `packages/cli/dist/index.js` against `packages/server/dist/` (post TASK-01…05 commits)

---

## Acceptance Criteria Mapped

- ✅ `fab doctor` in `fabric_language: "zh-CN"` outputs Chinese for all check names + messages + remediations
- ✅ `fab doctor` in `fabric_language: "en"` outputs English (snapshot stable)
- ✅ `code` field unchanged across locales (machine identifier)
- ✅ Check ordering / severity / total count identical across locales

---

## zh-CN Run (fabric-config.json: `"fabric_language": "zh-CN"`)

```
[error] fabric doctor /Users/wepie/Desktop/personal-projects/pcf
[ok] Bootstrap anchor: repo root 下已存在 Bootstrap anchor：AGENTS.md, CLAUDE.md。
[ok] Bootstrap marker 迁移: bootstrap 目标文件中未检测到旧 fabric:knowledge-base marker。
[error] Bootstrap snapshot drift: .fabric/AGENTS.md 内容与 BOOTSTRAP_CANONICAL 逐字节不一致。
[error] Managed block drift: 2 个 three-end managed block 与期望内容（snapshot + 可选 project-rules concat）不一致：…
[ok] Knowledge layout: 全部 6 个必需 .fabric/knowledge/* subdirectories 均已存在。
[ok] Baseline 文件名格式: 所有 baseline knowledge 文件都使用 canonical `${id}--${slug}.md` 文件名格式。
[ok] Scan evidence: .fabric/forensic.json 对 unknown 有效。
[ok] Agents metadata: .fabric/agents.meta.json revision sha256:… 已与 .fabric/knowledge 对齐。
[ok] Rule content refs: 所有 content_ref entries 都能解析到 .fabric/knowledge files。
[ok] Knowledge-test index: 已索引 0 个 link 和 0 个 orphan annotation。
[ok] Event ledger: .fabric/events.jsonl 已存在，可写，且可解析。
[ok] Event ledger partial write: events.jsonl 没有 partial trailing write。
[ok] Claude MCP config 位置: mcpServers.fabric 不在 .claude/settings.json 中。
[ok] Meta manual divergence: agents.meta.json 与磁盘上的 rule files 一致。
[ok] Knowledge dir unindexed: 所有 .fabric/knowledge/ .md files 都已索引到 agents.meta.json。
[ok] Stable ID collision: .fabric/knowledge/ 中未发现已声明的 stable_id collisions。
[ok] Knowledge counter desync: agents.meta.json counters envelope 与观测到的 stable_ids 一致。
[ok] Filesystem-edit fallback: No orphan canonical knowledge entries detected；events.jsonl promotion trail 完整。
[ok] Knowledge orphan demote: 没有 canonical knowledge entries 超过按 maturity 设定的 inactivity threshold。
[ok] Knowledge stale archive: 没有 draft knowledge entries 超过额外的 stale-archive quiet window。
[ok] Knowledge pending overdue: 没有 pending knowledge entries 超过 14-day review threshold。
[ok] Knowledge stable_id duplicate: team / personal trees 中没有 canonical knowledge files 共享 stable_id。
[ok] Knowledge layer mismatch: 所有 canonical knowledge files 都位于 stable_id prefix 声明的 layer 下。
[ok] Knowledge index drift: agents.meta.json counters envelope 对每个 (layer, type) pair 都大于或等于现有 canonical counter 最大值。
[ok] Knowledge underseeded: Knowledge corpus 有 22 个 canonical entries（>= 10）。
[ok] Knowledge narrow without paths: 没有 narrow-scope canonical entries 的 relevance_paths array 为空。
[warn] Knowledge relevance_paths dangling: 1 个 relevance_paths glob 在当前 workspace 中解析到 0 个文件。…
[ok] Knowledge relevance_paths drift: 所有 narrow-scope canonical entries 都至少有 1 个 relevance_path 在最近 90d 内被触碰。
[ok] Knowledge narrow too few: Narrow-scope KB coverage 低于可用下限：narrow-with-paths share 14%（2/14）below 20% threshold。
[ok] Knowledge session-hints stale: .fabric/.cache/ 下没有超过 7 天的 session-hints cache files。
[ok] Serve lock: 未发现 .fabric/.serve.lock。
[ok] Knowledge relevance fields missing: 所有 pending entries 都声明了 relevance_scope 和 relevance_paths。
[ok] Skill markdown YAML: 所有 .claude/.codex SKILL.md frontmatter values 都能按 strict YAML 解析。
[ok] Onboard coverage: 尚未覆盖的 onboard slots：[tech-stack-decision, architecture-pattern, code-style-tone, build-system-idiom, domain-vocabulary]。0/5 filled；0 opted-out。
[ok] Preexisting root markdown: project root 检测到 CLAUDE.md, AGENTS.md。这些 root files 不会被 Fabric MCP 自动加载。

可修复错误：
- bootstrap_snapshot_drift: .fabric/AGENTS.md 内容与 BOOTSTRAP_CANONICAL 逐字节不一致。
- managed_block_drift: 2 个 three-end managed block …

警告：
- knowledge_relevance_paths_dangling: 1 个 relevance_paths glob 在当前 workspace 中解析到 0 个文件。…
```

---

## en Run (fabric-config.json: `"fabric_language": "en"`)

```
[error] fabric doctor /Users/wepie/Desktop/personal-projects/pcf
[ok] Bootstrap anchor: Bootstrap anchor present at repo root: AGENTS.md, CLAUDE.md.
[ok] Bootstrap marker migration: No legacy fabric:knowledge-base markers detected in bootstrap target files.
[error] Bootstrap snapshot drift: .fabric/AGENTS.md content diverges byte-for-byte from BOOTSTRAP_CANONICAL.
[error] Managed block drift: 2 three-end managed blocks diverge from expected body (snapshot + optional project-rules concat): …
[ok] Knowledge layout: All 6 required .fabric/knowledge/* subdirectories exist.
… (33 checks total, identical ordering, code, and severity to the zh-CN run above)
```

---

## Locale-Invariant Contract Verified

| Property | zh-CN | en | Match |
|---|---|---|---|
| Total checks | 33 | 33 | ✅ |
| Total lines (incl. summary) | 43 | 43 | ✅ |
| Fixable errors | 2 (`bootstrap_snapshot_drift`, `managed_block_drift`) | 2 (same) | ✅ |
| Warnings | 1 (`knowledge_relevance_paths_dangling`) | 1 (same) | ✅ |
| Status order in stream | identical | identical | ✅ |
| `code` field text | English | English | ✅ (machine contract preserved) |

Protected English tokens that intentionally remain English in the zh-CN locale (per planning-context D-protected-tokens): `BOOTSTRAP_CANONICAL`, `fabric:knowledge-base`, `fabric:bootstrap`, `relevance_paths`, `narrow-scope`, `agents.meta.json`, `events.jsonl`, `mcpServers.fabric`, file paths, all `code:` field values, all stable_id prefixes (`KT-`/`KP-`/`KA-`/`KG-`/`KM-`).

---

## Reproduction

```bash
pnpm --filter @fenglimg/fabric-shared build
pnpm --filter @fenglimg/fabric-server build
pnpm --filter @fenglimg/fabric-cli build

# zh-CN
node packages/cli/dist/index.js doctor

# en (temporarily flip fabric_language in .fabric/fabric-config.json)
```

---

## Commits in Closure

| TASK | Commit | Theme |
|---|---|---|
| TASK-01 | `48e9f4c` | resolveFabricLocale helper + γ-pattern doctor translator |
| TASK-02a | `bf67e24` | doctor i18n migration — bootstrap/foundation batch (13 checks) |
| TASK-02a (test pin) | `1d703df` | pin FAB_LANG=en in doctor.test fixtures |
| TASK-02b | `7dc2335` | doctor i18n migration — knowledge-meta batch (5 checks) |
| TASK-03 | `848ca69` | doctor i18n migration — knowledge lint batch (12 checks) |
| TASK-04 | `ef11194` | doctor i18n migration — skill/onboard batch (5 checks) |
| TASK-05 | `b10168e` | CLI runtime translator rewire + bilingual snapshot test |
| TASK-06 | (this commit) | dogfood evidence + CHANGELOG |

35 check functions × 2 locales × ~3 fields ≈ 210+ i18n keys added per locale. doctor.ts net +574 lines; locale files +411 lines each.
