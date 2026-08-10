# Design — 双轨 roadmap 的产出方法

## 总体架构

分析型任务,无产品代码改动。产出物 = `roadmap.md` 单文档,双轨合并、双层叙述(摘要层大白话 / 附录层技术依据)。

## 轨A: Trellis 机制判定(主线执行)

数据源: `research/trellis-design.md`(20 条机制)× `research/fabric-current-state.md`(痛点清单)。

判定 rubric,每条机制四选一:

| verdict | 要求 |
|---|---|
| **steal** | 一句话设计重写方案(不抄码,AGPL)+ 对应哪个 fabric 痛点 + 落地面(doctor/skill/store/hook 哪块) |
| **already-have** | 指认 fabric 现有实现路径(以 `packages/cli/templates/` 与 packages 源码为真源,per KT-PIT-0048) |
| **skip** | 理由,并锚定先例决策(如 KT-DEC-0078/0072)或成本论证 |
| **需重议** | 与 KT-DEC-0078 don't-steal 冲突的条目(任务载体/journal 类),单独分组呈报,不进默认 roadmap |

每条 steal 附: 价值÷成本 一行 + P0/P1/P2。判定过程中对"already-have 是否属实"必须 grep/Read 源码核证,不凭印象(per feedback_audit_verification)。

## 轨B: 精简审计(research agents 分包取证 + 主线综合)

六维度 × 取证方法:

1. **包边界**: server-http-experimental 的引用/发布状态(是否可归档);server 198 文件的目录分层现状。
2. **重复/重叠子系统**: 同名/同职责模块(如 cache 双目录前科 KT-DEC-0085)、CLI 命令与 MCP 工具与 skill 的职责重叠。
3. **dead code**: 无引用导出、退役命令残留(tombstone 之外)、未接线的实验代码。
4. **巨型文件**: >800 行源文件清单 + 各自可拆分的自然缝。
5. **双份维护面**: templates(83 文件 21.4k 行)与安装副本的同步机制、漂移风险点。
6. **命令面蔓延**: CLI 子命令/flag 总数、低频命令识别。

分工: 3 个 trellis-research agent 并行 —— ①server 包 ②cli 包+templates ③shared+server-http-experimental+仓库级(scripts/CI/双份维护面)。产出落 `research/complexity-{server,cli,shared-misc}.md`。主线只做综合与裁剪,不重复取证。

约束: 只诊断不修复;每条提案必须带数字(文件数/行数/引用数);对 flaky(ISS-003)相关结论标注不确定性。

## roadmap.md 结构

```
1. 一页摘要(大白话): 这次看出了什么病、推荐先治哪三个、为什么
2. 轨A判定表: 20 行 × (机制 | verdict | 对应痛点 | 价值÷成本 | 优先级)
3. 「需重议」组: 单独呈报,给重议所需的决策材料
4. 轨B精简提案: 按优先级排序,每条带数字证据
5. 分批落地建议: 每批一个可独立收口 scope + 依赖关系
附录: 依据引用(研究文件锚点、代码路径、先例 KT-id)
```

## 工作流形态

inline workflow(主线综合 + research agents 仅取证),不走 implement.jsonl 子代理 dispatch gate。质量自检用 acceptance criteria 逐条核对(census 20/20、数字在场、双层叙述)。

## 沉淀出口

roadmap 经用户评审定稿后: 关键判定(skip 理由 / 需重议结论 / 用户批次拍板)走 fabric-archive 归档 pending,由用户 fabric-review 审批 —— 吃自己的狗粮,也是对 KT-DEC-0078 的增量更新。
