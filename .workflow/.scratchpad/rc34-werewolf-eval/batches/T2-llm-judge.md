# Batch 2: Cross-LLM Judge Findings

## 执行说明
- **Gemini 第一次**: failed (workspace 限制读 werewolf 路径)
- **Gemini 第二次**: ✓ (copy SKILL.md 到 pcf scratchpad 后)
- **Codex**: failed (stream stale 600s, 输出只有 tool 调用没真分析) — 不重启, 改用 Claude 内联推进
- **Claude inline**: KB entry 质量 + Codex 缺位的 cite infra audit (已在 Batch 1 完成)

---

## P0-6 — SKILL.md description recall 在 werewolf 老安装下严重退化 (Gemini 量化)

**Gemini 18-cell 触发矩阵结果**:

| 版本 | Token | 中文短语 | Recall | False-Positive |
|---|---|---|---|---|
| OLD (werewolf 当前 rc.30 安装) | ~85 平均 | 0 个 | **3/5 (60%)** | 1 (T4 误触) |
| NEW (pcf rc.34 W1 重构) | ~40 平均 | 5-6 个 | **5/5 (100%)** | 0 |

**关键改进 (Gemini 提取)**:

1. **fabric-archive 口语化 trigger 命中** (T1/T2):
   - OLD: "Use this skill when the Stop-hook signals..." — 偏系统机制,无"以后"等日常表达
   - NEW: 显式列举 trigger 短语 (`以后/always/never/下次/记一下;wrong-turn-revert;decision-confirm`)
   - werewolf 用户真说"以后这种角色 buff 都加二级冷却" → OLD 不触发, NEW 触发

2. **fabric-import 边界负向约束防误触** (T4):
   - OLD: "mines git log" → Gemini 模拟 AI 看到"git 中作者 wangzhichao 做过卧底音乐吗"会误以为 fabric-import 是通用 git 查询
   - NEW: 加 `(NOT code/data import)` 负向 → 拦截误触发
   - **这是 OLD 版本的隐性污染**: 用户日常 git history 询问可能被 fabric-import 截胡, 拖累正常工作流

3. **token 缩减 ~50%**: NEW description ~40 tok 平均 vs OLD ~85 tok, 但召回提升

**结论 (Gemini)**: "老项目必须重装/覆盖更新技能 (Yes)"

**与 Batch 1 P0-4 (archive 行为接近零) 关联**:
- werewolf 8 天 46 session 只 1 次 self-archive — 现在归因清楚: OLD description 完全错过"以后"这类口语化 trigger
- archive 这个 skill 在 werewolf 上实际 recall 只 1/3 (T3 pitfall 路径 work, T1/T2 normative + revert 路径全 miss)

---

## P0-7 — 48 entry 全部由单次 fabric-import 产出, 8 天工作流贡献 0 (仅 1 pending)

**数据扫描** (Claude 内联 grep):
- 48 canonical entry 全部 `source_sessions: ["fabric-import-2026-05-13-r2"]`
- 唯一 1 个真实 session 产出: `pending/models/spy-abstain-by-vote-right.md` (2026-05-21, source_sessions=`["d2da7a44-..."]`, proposed_reason=`diagnostic-then-fix`)
- 即 5-13 → 5-26 共 13 天活跃开发,**新增 1 个 pending knowledge, 0 个 canonical promote**

**Why** (与 P0-4 / P0-1 / P0-6 同根):
- fabric-archive 老 description 召不出 → AI 不触发 self-archive
- 即使触发了, fabric-review 老 description 也召不出 → backlog 不审 → 100% 卡 draft (P1-5)
- 用户也没主动喂新知识 (1 archive attempt 在 46 session 跨 8 天)

**Impact**:
- KB 知识库变成 5-13 一次性快照, 完全没有"活的"增长
- 新发现 (像今天用户说"还原一下不要新功能" → SpyGameSoundUtil 撤销 → 应该是 wrong-turn pitfall) 0 沉淀

---

## P0-8 — 100% entry empty tags `[]`, 完全无语义标签

**数据**: 全 48 entry 都是 `tags: []`. 无一例外.

**Why**:
- `fabric-import` (cold-start bulk) 不产 tags (只填 source_sessions / proposed_reason / relevance_paths)
- `fabric-archive` 描述里也没要求产 tags
- AI 自评时也不主动加 tags
- doctor 没 lint 空 tags

**Impact**:
- 跨 entry 主题聚类失效 (e.g. "所有 cocos atlas 相关 pitfall" 找不到)
- 未来 wiki/graph 建图无信号
- AI 用 plan_context 时只能靠 relevance_paths glob 匹配, 软主题匹配完全 0

---

## P1-6 — Codex delegate 失败的根因 (副发现)

**症状**: codex --mode analysis 跑 600s 无输出, 只回 tool 调用名 (sed/rg)

**Why (假设)**:
- Codex CLI 在跑 read/grep 但不返回中间结果给 maestro stdout 管道
- 或 codex 在 deep-think 但 600s 超时上限被 maestro 切

**Impact**: 跨 LLM 协作设计上需要 ≥ 2 家 (Gemini + Codex + Claude 三家共识), 实际 Codex 路径不稳

**Remediation**:
- 短期: 跨 LLM 任务 prompt 加 "前 60s 必须返回首轮摘要" + 减少 tool call 步数
- 长期: maestro delegate 配置 codex --timeout 更长 OR 把 codex 任务拆小

---

## P2-5 — KB entry 内容本身质量 OK, 不是质量问题, 是流量问题

抽样 (KT-PIT-0001 atlas premultiply / KT-DEC-0001 friend-invite):
- 内容真实, 工程价值清晰 (cocos 渲染坑 / social UI 多游戏类型抽象)
- 但格式僵化: 全部来自 git log import, 每条都有相同 schema (Summary / Why proposed / Session context / Evidence Recent paths / Notes)
- 缺乏深度 (没"详细 code 示例" / "edge case" / "trade-off")

**结论**: 老 entry 质量 6 分 (能用不深), 但流量是 0 — 修不是优先级, 拉流量 (P0-4) 是.

---

## Cross-LLM 协作元教训

- Gemini workspace 路径硬限制: 必须 copy 跨项目内容到 caller workspace 才能读. 跨项目审计场景下要预拷贝
- Codex delegate 在多步 grep/read 场景容易 stream stale → 任务粒度要拆小或换更直接 prompt
- Claude inline (本地) + Gemini delegate (第二视角) 的两家组合 cost 性价比远高于 3 家强求 (Codex 不稳定 ~ 50% 浪费)
