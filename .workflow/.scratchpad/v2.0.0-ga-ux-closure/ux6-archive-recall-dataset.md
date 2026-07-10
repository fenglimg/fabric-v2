# UX-6 fabric-archive recall dogfood (rc.37 NEW-4 简化后复测)

## 召回定义
recall = (真值可归档 insight 中, 被 Phase 2.5 viability gate 判 PASS 并提议的数量) / (真值可归档总数)。
baseline rc.32 = 20% (旧 8-signal gate)。target ≥40%, floor ≥30%。
rc.37 NEW-4 把 8 信号合并为 3 大类 (User-driven knowledge expression / Reflective discovery / Concrete artifact change), 假设召回上升。

## Phase 2.5 viability gate (3 大类, 命中任一即 PASS)
1. **User-driven knowledge expression**: normative (always/never/from now on/下次注意/记一下/以后/永远不要) OR ≥2 备选权衡+rationale OR 拒绝某法+给理由
2. **Reflective discovery**: AI 试 X 反思改 Y (wrong-turn-revert) OR >15min/>10turn 诊断挖出非显然根因 OR session 中命名可复用 pattern
3. **Concrete artifact change**: 新增依赖 (package.json/pyproject/Cargo diff) OR 多步 load-bearing 流程被定序形式化
anti-signal (即便像也不归档): typo / 简单 refactor / rename / 与现有 canonical 重复

## Labeled session moments (真值)

| # | session moment | 真值可归档? | 命中类别 |
|---|---|---|---|
| A1 | 用户:以后改 packages/shared/src/schemas 都要 pnpm build, 否则 runtime invalid_union | YES | 类1 normative |
| A2 | 用户:我们权衡了 implicit 和 PKCE, 选 PKCE 因为 SPA 无法安全存 client_secret | YES | 类1 decision+rationale |
| A3 | AI:先试正则解析 frontmatter, 边界 case 太多, 改用 gray-matter AST | YES | 类2 wrong-turn-revert |
| A4 | 会话给 package.json 加了 zod ^3.23 依赖 | YES | 类3 new dependency |
| A5 | 30 分钟诊断后发现 sprite 黑边根因=atlas.premultiplyAlpha flag 反向 | YES | 类2 非显然根因 |
| A6 | 用户:永远不要在 release CI 里 skip tsc --noEmit | YES | 类1 normative never |
| A7 | 会话把发版固定为定序流程: bump→sync-versions→tag→push→watch CI | YES | 类3 形式化多步流程 |
| A8 | 用户:这个我们叫它 'two-step recall' 模式, 后面统一这么说 | YES | 类2 命名可复用 pattern |
| A9 | 用户:这个方案我否了, 因为它会破坏 backward compat, 历史装机会炸 | YES | 类1 dismissal+reason |
| N1 | 修了 readme 里一个 typo | NO | anti: typo |
| N2 | 把变量 foo 重命名为 userId | NO | anti: rename |
| N3 | 用户:这个 useEffect 怎么用? | NO | 纯询问无 normative |
| N4 | 跑一下 pnpm test | NO | 纯操作 |
| N5 | 用 prettier 格式化了文件 | NO | anti: 格式化 |
| N6 | 又记一次 '改 schema 要 rebuild' (已有 canonical KT-PIT) | NO | anti: 与现有 canonical 重复 |

真值可归档 9 (A1-A9), 不可归档 6 (N1-N6)。

## 评分
recall = A 中被判 PASS 数 / 9。precision = TP/(TP+FP)。
target recall ≥40% (≥3.6→≥4/9); floor ≥30% (≥3/9)。

## 结果 (2 LLM 盲判, 零上下文)
- Judge1 (claude context-clean subagent acde55b6): A1-A9 全 ARCHIVE, N1-N6 全 SKIP
- Judge2 (gemini bbnu2x1j3, 零上下文): 同上, 完全一致
recall = 9/9 = **100%** ≥ target 40% (baseline rc.32 20%, floor 30%) → PASS。precision = 9/9 = 100% (0 误归档, N6 重复正确滤除)。
rc.37 NEW-4 把 8 信号合并 3 大类后, gate 对全部 9 类可归档信号 (normative/decision/wrong-turn/根因/命名 pattern/依赖/流程/dismissal) 零漏。
caveat: 本测度量的是 viability gate (rc.32 P0 瓶颈) 召回; 真实端到端召回还受 Phase 1/2 collection (session 是否 surface 该 moment) + dedup 影响, 但 gate 这层已高召回。
