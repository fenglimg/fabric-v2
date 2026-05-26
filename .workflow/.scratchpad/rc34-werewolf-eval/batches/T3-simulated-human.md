# Batch 3: Simulated Human Dogfood (4 场景)

## Scenario H1 — 新 dev 打开 werewolf SessionStart

**预期**: 看到 broad-scoped KB 列表 ("48 entry available" 之类), 即得知项目有哪些 pitfall/decision 沉淀.

**实际 (用 werewolf 全局 fab rc.30)**:
- SessionStart hook 调用 `fabric plan-context-hint --all`
- **CLI 报 schema 错: "received 'model' expected 'models'"** → 整个 plan-context-hint 命令崩溃
- Hook silent exit 0 (per `Failure invariant`)
- AI / 用户 **完全看不到任何 KB 列表**

**P0-9 — 全局 fab 与 werewolf .fabric/agents.meta.json schema desync**:
- werewolf 上的 `agents.meta.json` 用 singular `knowledge_type: "model"` (老格式)
- 全局 fab rc.30 schema 严格要 plural `"models"` (rc.31 z.preprocess fix 才容忍 singular)
- rc.31+ 修复在 werewolf 上**完全没生效**因为 hook 调全局 fab 而不是 dev
- Doctor 当前没 lint 这个 — 用户感觉不到全局版本是死的

**Why impactful**:
- Onboarding 第一印象: AI 看到 AGENTS.md 说有 KB → 调 plan-context → 空 → 当成 KB 没存在
- 即使用户后来用 `fab doctor` 跑出来 ERROR (其实跑不出来, doctor 自己用 rc.30 schema 一样爆炸 — 未验证, 但风险大), 也不知道根因是版本

**Remediation**:
- 出 release blocker / 强制 lint: 检测到 fab version != installed schema version 时给清晰错误
- 或在 install 时把 dev cli 路径写死到 hooks (脱离全局 PATH)

---

## Scenario H2 — Edit assets/Script/Business/SpyGame/SpyGameSoundUtil.ts (PreToolUse narrow hint)

**预期**: PreToolUse hook 推 narrow-scoped 相关 KB (跟 SpyGame audio 相关的 pitfall/decision).

**实际**:
- 全局 fab rc.30 同样炸 → silent exit
- 用 dev cli rc.34 跑: 返回 43 entries (2 narrow + 41 broad), 命中 KT-PIT-0012 / KT-PIT-0013 (cross-bundle prefab trap + remote bundle order)

**但 hint 渲染质量问题 (P0-10)**:
- 输出 entries 中 42/43 个 summary 字段 == ID 本身 (`"KT-PIT-0012", summary: "KT-PIT-0012"`)
- 只有 KT-MOD-0016 一个 verified entry 有真 summary ("README first paragraph")
- 即 AI 看到的 narrow hint 是: `KT-PIT-0012 · KT-PIT-0012 (narrow)` — 完全 opaque
- AI 无法基于 summary 判断哪个该 fetch, 只能全 fetch 或全跳过 → 实战 100% 全跳过 (P0-3 验证)

**Why**:
- `agents.meta.json` schema 里没强制每个 node 都有非空 description.summary
- 旧 cold-start import 没产 summary 字段
- 4 个 verified entry 才补了 summary

**Remediation**:
- doctor 加 lint: `node.description.summary == node.id` 报 warning
- fabric-archive / fabric-import 默认产 ≥10 字符 summary
- 或 fallback: 渲染时若 summary == id, 临时读 .md 文件首行 ## Summary 充当 summary

---

## Scenario H3 — Normative archive ("以后 audio toggle 都先存 settings")

**预期 (per .fabric/AGENTS.md self-archive policy)**:
1. AI 检测 "以后" → 当 turn 末写 marker 行 `self-archive policy triggered by signal: Normative`
2. AI 调用 fabric-archive skill (E3-strong mode)
3. fab_extract_knowledge → 落 pending/decisions/
4. 用户看到提示 "顺手归档: 注意到你说 ..."
5. fab_review 接力

**实际**:
- Werewolf 当前 SKILL.md description 是 OLD rc.30 版本 → Batch 2 测得 normative trigger recall **0/2** (T1 + T2 都不命中)
- 即 AI 看到 description 不知道 fabric-archive 该被 normative 触发
- 加上 .mcp.json 指向全局 rc.30 fab-server (P0-9): 即便 AI 强行调 fabric-archive, MCP 也用旧 schema
- 8 天 46 session 实战只 1 次 archive_attempt → **整个 self-archive policy 在 werewolf 端结构性死亡**

**根因链**:
1. P0-9 全局 fab 版本死锁 → hook 静默 → AI 不知道 KB 存在
2. P0-6 SKILL.md description 老 → AI 看到不 trigger
3. P0-5 token 超标 → host 端可能也降权
4. P0-1 cite policy 同源 → 没正反馈让 AI 学会 cite

---

## Scenario H4 — Doctor remediation 可操作性

跑 `fab doctor` 看 6 个 issue 的修复指南:

| Issue | Remediation | 用户能直接做? |
|---|---|---|
| `skill_token_budget_exceeded` (ERROR) | "把详细内容下沉到 `templates/skills/<slug>/ref/`" | **❌ 假设用户有 pcf 源码** (werewolf 装的是 npm 包, 没 templates/) |
| `agents_meta_stale` (WARN) | "可忽略;engine 自动修复" / "需要时跑 `fab doctor --fix`" | ✅ 可操作 |
| `skill_description_quality` | "编辑 `packages/cli/templates/skills/<slug>/SKILL.md` frontmatter" | **❌ 同上, npm-installed 用户碰不到** |
| `cite_goodhart_pattern G5` | "审阅触发的 pattern: G1 仪式化 → ... G2 抄底 → ... G5 placeholder" | **❌ AI 内部词汇 (G1/G2/G3/G5), 用户读不懂, 没有"找到具体 cite 的 turn 在哪"指引** |
| `knowledge_draft_backlog 100%` | "调 `/fabric-review` 批量审" | **⚠️ 但 review skill description 也 OLD → 用户调不出** |
| `meta_manually_diverged` | "运行 `fab doctor --fix`" | ✅ 可操作, 但和 agents_meta_stale 同一命令 — 没注明 |
| `promote_ledger_invariant_violated` | "历史失衡仅是可观测性指示" | ⚠️ 弱化但仍展示 — 用户疑惑 "那为啥还报" |

**P0-11 — Doctor remediation 的"开发者偏置"** (5/7 假设用户有 pcf 源码或读 AI 内部词):
- 假设用户是 fabric maintainer (能改 templates/skills/) — 但 95% 用户是 npm 用户
- 没区分 "用户该做什么" vs "下个版本 fix 什么"
- AI 内部分析词汇 (G1-G5 / cite_tag categories) 直接出现在 user-facing 文案

---

## H 横切总结: 整个使用闭环在 werewolf 端 90% 失效

```
[新 dev 开 session] → SessionStart hook 调 fab → schema 爆炸 → silent → AI 不知 KB 存在 (P0-9)
                                                                              ↓
[AI 该 cite 时]    → skill description OLD recall 60% → 没 cite → cite_tags=[] (P0-1)
                                                                  ↓
[AI 编辑文件]      → PreToolUse hook → 若不 silent → opaque summary → AI 全跳过 (P0-10)
                                                                       ↓
[用户说 normative] → AI 该 self-archive → SKILL OLD 不命中 'normative' → 0 触发 (P0-4 / P0-6)
                                                                          ↓
[pending 该 review] → SKILL review OLD 不命中 → backlog 100% draft → 越积越多 (P1-5)
                                                                       ↓
[用户跑 doctor]    → 6 个 issue → 5 个 remediation 不可操作 (P0-11) → 用户放弃
```

**唯一 work 的链路**: 用户手工调 fab CLI 时, dev cli 路径能干活. 但日常自动闭环 0%.
