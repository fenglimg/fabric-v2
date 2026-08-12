# 参考 Trellis 设计优化 fabric-v2

## Goal

产出一份**双轨优化 roadmap** 供用户评审:

- **轨A「Trellis 对照」**: 对研究盘出的 20 条 Trellis 机制逐条判定 steal(设计重写)/ skip(带理由)/ already-have(指认实现),带优先级。
- **轨B「精简去繁」**: 对 fabric-v2 代码库做工程清晰度审计,产出带数字证据的精简提案(用户观感: 代码太繁杂、像纯 vibecoding 产物、不如工程化项目清晰)。

评审通过后分批落地;**落地实施是后续任务,不在本任务内**。

## Background(证据与先例)

### 先例决策(fab_recall 召回,正文已读)

- KT-DEC-0078 (07-12 归档, 07-29 复核): 含 Trellis 的 6 仓对照已做过,锁定「只抄 micro-transfer、不整仓 morph」;任务载体/PRD/journal 判 hard don't-steal(定位稀释 + Trellis 为 AGPL)。
- KT-DEC-0072: 产品方向 = 知识层 only、非 workflow 编排器。
- KT-PIT-0058: Trellis 的 knowledge-ish 概念与 Fabric curated knowledge 是 false friend,对齐先分层。
- KT-PIT-0048: 架构判定必须对源模板(`packages/cli/templates/`),不可对 `.claude/` 安装副本 —— 轨A判定的方法约束。

### 研究结论(细节见 research/ 两份文件)

- `research/trellis-design.md`: Trellis 20 条机制清单 + 核心 taste(确定性脚本引擎+AI 只做判断 / phase gate 强制收敛 / 沉淀是必经闸口 / fail-visible / 按半衰期分四层记忆 / full-copy+hash 分发)。
- `research/fabric-current-state.md`: 正式未完项 3 条(ISS-001 归档全量扫 high / ISS-002 forensic 裸 walk / ISS-003 测试 flaky)+ 非正式挂账(README 版本漂移、config deferred 等);上次 4 个 micro-transfer 已全落地,唯 bet#8「finish→archive 产品化」partial;薄弱环节 top: 无任务轴/journal(有意边界)、归档成本、写入摩擦、首价值路径脆、行为改变不可观测、文档漂移复发。
- 本 session 实证: Trellis 安装器把 `.claude/settings.json` 追加成双 JSON 对象(非法),fabric+trellis hooks 全哑;已手工无损 merge 修复。暴露 fabric 缺口: doctor 不体检 settings 合法性、install 无第三方共存 merge 防御。

### 代码规模基线(2026-08-10,src 下 .ts/.cjs/.mts)

| 包 | 文件数 | 行数 |
|---|---|---|
| server | 198 | 54,413 |
| cli | 85 | 24,090 |
| shared | 82 | 15,724 |
| server-http-experimental | 19 | 2,603 |
| templates(分发面) | 83 | 21,402 |

测试文件 307 个。巨型文件样本: `doctor.ts` 1,967 行、`api-contracts.ts` 1,916、`skills-and-hooks.ts` 1,570、`forensic.ts` 1,475;最大测试文件 2,886 行。

## Requirements

- **R1 轨A判定表**: 20 条机制逐条给 verdict(steal/skip/already-have/需重议)+ 对应 fabric 痛点 + 价值÷成本 + 优先级(P0/P1/P2)。判定守 KT-DEC-0078 边界;「任务载体/journal」类如判 steal,必须单独分组标注「需重议 KT-DEC-0078」,不混入默认 roadmap。
- **R2 轨B审计**: 至少覆盖六个维度 —— ①包边界(含 server-http-experimental 处置、server 巨包内部分层)②重复/重叠子系统 ③dead code ④巨型文件 ⑤模板↔安装副本双份维护面 ⑥命令面蔓延。每条提案带: 现状证据(路径+规模数字)、提案、风险、优先级。只诊断不动手。
- **R3 合并 roadmap**: 双轨合并为单份 `roadmap.md`(落本任务目录),分两层: 摘要层用大白话+价值÷成本(用户无工程背景),附录层放技术细节与依据引用;末尾给分批落地建议(每批一个可独立收口的 scope)。
- **R4 知识沉淀**: roadmap 定稿后,把关键判定(尤其 skip 理由与需重议项)走 fabric-archive 归档为 pending,防下次重复论证。

## Acceptance Criteria

- [x] roadmap.md 覆盖全部 20 条机制,无遗漏(census 完整性 20/20 — node 复核判定表数据行 = 20)
- [x] 每条判定有明确 verdict + 依据引用(文件路径或研究文件锚点);steal 类附一句话设计重写方案(6 张 steal 卡)
- [x] 轨B六维度全覆盖,每条提案带规模数字(§4 头部有维度→提案勾稽索引)
- [x] roadmap 摘要层非工程师可读(§1 大白话一页摘要)
- [x] 用户完成评审并对分批落地顺序拍板(2026-08-10 完成,裁决见 roadmap.md §0)

## Key Decisions

- 2026-08-10 用户裁决: 方向 = 全景 roadmap 先行,并新增「精简去繁」为并列轨。
- 守 KT-DEC-0078 micro-transfer 边界;任务载体类单独分组「需重议」而非默认纳入。
- AGPL 约束: 只借鉴 Trellis 设计,禁止复制其代码。
- 本任务 roadmap-only,不改产品代码(settings.json 修复属环境修复例外,已完成并验证)。

## Out of Scope

- roadmap 各批次的落地实施(后续任务承接)。
- 把 Fabric 整仓 morph 成 SDD 编排器/任务机/文档 RAG。
- 修 ISS-001/002/003 本体(进 roadmap 排期,不在本任务动手)。

## Risks / Deferred

- 轨B审计结论可能与 flaky 测试(ISS-003)、worktree 假红纠缠 → 审计只诊断、标注不确定性,不做修复。
- Trellis 现装版本比 07-12 分析的 `bde902c` 新 → 轨A判定一律以现装版为准。
