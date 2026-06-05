# Discovery Rubric — 方法论"问题暴露完备性"行为型评分

> 给冷评 agent 用：评一份测试方法论文档，**不看它写得漂不漂亮，只看"按它执行能不能把下面 5 类问题逼出来"**。
> 行为型锚（描述"方法论必须指示 agent 做的动作"），**不编码具体签名/文件名**（那会随码漂移）。
> 每维 0-5 分 + 必附"按此方法论会漏掉的 distinct gap"（gap 才是优化信号）。

## 5 个暴露维度

### D1. 已知问题（known issues）
方法论是否指示 agent **主动消费已有知识/历史**（KB/issue/changelog/已知 pitfalls）作为发现起点，而非从零重发现？
- 5：强制先 census 已知 + 把已知当回测锚
- 0：完全不提已有知识，每次从零

### D2. 疑似 bug（suspected bugs）
是否提供**主动制造失败条件**的指示（注入损坏/边界/规模/并发/降级路径），而非只跑 happy path？
- 5：invariant oracle + 系统化注入矩阵（corrupt/offline/scale/concurrent）
- 0：只验声明功能正常路径

### D3. 任何可疑点（anything suspicious）
是否有**低门槛登记可疑候选 + verify-before-trust 漏斗**（候选≠finding，先记后验，refuted 记 reason）？是否鼓励 LIBERAL capture？
- 5：候选自由登记 + deterministic 验证阶梯 + refuted 留痕
- 0：只记"确认的 bug"，可疑点直接丢

### D4. 功能做了但没接入（hollow / not-wired）★ 最难、最考验
是否强制 **producer→consumer round-trip 断言**（写进去能不能读出来），而非只查 surface 响应？是否要求**造触发数据走缝**？是否有 facet 坍缩检查？
- 5：每能力配 round-trip + 符号级查零消费者 + 造数据 + facet 坍缩
- 3：提了端到端价值链但停在粗粒度（抓得到"0 push"抓不到"server 零 import"）
- 0：surface census 查响应就算过（会被 scaffolding 假绿骗过）

### D5. 漏做了（missed work / 声明缺实现）
是否有 **declared-vs-impl + census 全集**比对（声明面 ∈ {covered}∪{waiver}，新增无覆盖自动 red）？是否查 doc/注释/schema 声称 vs 代码实际？
- 5：census 从声明源 grep 全集 + declared-vs-impl + doc-vs-code 三管齐下
- 0：只测"列出来的功能"，没声明全集概念

## 横切维度（影响全部 5 维，单列）

### X1. 防假收敛（frame honesty）
方法论是否承认"多-LLM/critic 收敛 ≠ 正确"，并**强制 human frame 挑战**作为收敛前提？
- 5：收敛 = 多-LLM dry AND human frame 挑战通过
- 0：多-LLM 说收敛就停（结构性盲区永远抓不到）

### X2. 可移植性 / anti-bloat
方法论是否对**任意项目**可执行（镜头通用、声明源是项目 data），不编码会漂移的具体签名？
- 5：纯行为型 + census 模式吸收长尾
- 0：硬编码 Fabric 专有路径/字段名

## 评分输出格式（每个冷评 agent 须按此返回）
```
D1: <0-5> | gap: <按此方法论会漏的 distinct 缺口，无则 "none">
D2: <0-5> | gap: ...
D3: <0-5> | gap: ...
D4: <0-5> | gap: ...
D5: <0-5> | gap: ...
X1: <0-5> | gap: ...
X2: <0-5> | gap: ...
TOP_GAPS: <按对发现力影响排序的 top 3 distinct 缺口，这是优化的真信号>
BACKTEST_VERDICT: <对答案集 CONFIRMED 列表逐条: 此方法论能否浮出? 对 REFUTED: 能否正确驳回? 列漏判项>
```
