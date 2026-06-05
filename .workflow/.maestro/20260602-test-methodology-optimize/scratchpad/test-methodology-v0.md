# 全面测试方法论 v0（problem-discovery oriented）

> 目的：给一个 AI agent 一份可独立执行的方法论，使其对一个软件项目做"全面测试/审计"时，**能系统地暴露出所有有嫌疑的问题** —— 已知 bug / 疑似 bug / 任何可疑点 / 功能做了但没接入(空壳) / 漏做了。
> 单一靶子文档，被多-LLM 冷评 + 已知 finding 回测迭代优化。

---

## 0. 一句话纲领
全面 ≠ "把每条已知功能跑一遍看对不对"。全面 = **三轴覆盖 × 四 oracle 发现 × round-trip 防假绿 × frame 可被挑战**，跑到 loop-until-dry 收敛。

---

## 1. 三轴覆盖（缺一轴 = 有结构盲区）

| 轴 | 验什么 | 失败模式（漏这轴会怎样） |
|---|---|---|
| **深度（grounded）** | 每条 journey 真能跑、指向真实 anchor | 渐近 over-fit：逐签名/逐 export 无底钻 |
| **广度（surface×lifecycle×persona）** | 声明面全集 × 生命周期 stage × 使用者角色，每格 has-journey/N-A/GAP | 拿命名例子把面打死，漏掉整类 surface |
| **交互（agent-in-the-loop）** | 产品对 live agent 行为的真实影响（MCP 调用/skill 触发/hook delta/预算/策略遵守） | 把 agent mock 掉，漏验产品本体的交互价值 |

> 深度收口：强制 grounding + 指向真实 anchor，**签名交给 tsc/test-run，别编进方法论**（会随码漂移）。

---

## 2. 四 Oracle 发现器（candidate 不靠凭空想，靠 oracle 驱动）

每轮发现步取一条 oracle 当镜头，grep/read 驱动：

| Oracle | 找什么 | 典型 search recipe | 抓的真案例 |
|---|---|---|---|
| **producer-consumer** | 写了没人读 / 声明的回路没接通 | grep 某函数/能力的 consumer 数；=0 即空壳信号 | F-MULTISTORE-UNWIRED（store 写函数全仓零消费者；server 零 import store 层） |
| **declared-vs-impl** | 声明面在但实现是壳 / vocab 不一致 | 比对 schema enum vs config 引用值；比对命令声称 vs 实际 exec | F-MATURITY-ENDORSED（config 引 endorsed，schema enum 拒）/ F-SYNC-NOPUSH（声称 push 实际只 pull） |
| **doc-vs-code** | 文档/注释/帮助说的 ≠ 代码做的 | 比对 README/help/注释 vs 实现体 | sync 注释"walks+pushes"实则零 push |
| **invariant** | 应恒成立的性质被破坏 | 注入损坏/边界/规模/并发，观测是否优雅 | F-SCALE-LAT（O(N) 线性延迟）/ F-NARROW-BUDGET（narrow 条目被挤出候选池） |

> 不要用"8-perspective quality-smell"那种镜头做广度发现 —— 它结构性漏掉一致性/接线类 bug。

---

## 3. Round-trip 防假绿（反 scaffolding 铁律）★ 最易漏

**空壳缺陷不是"行为错"，是"接线空"。** 一个 scaffolding（声明面在、接线空）系统会：命令报 success、surface census 查到响应、行为测试跑通 —— 在"行为测试" frame 内**全绿**。缺陷只在 frame 外的 round-trip 问题下暴露。

**强制律**：对每个声明能力，配一条 **producer→consumer 回路断言** ——
"producer 侧写进去的数据，consumer 侧能真读出来吗？"

- 不止查 surface 响应，要符号级查 consumer 是否真 import/调用 producer 的输出路径。
- **造触发条件**：跨 store/跨 client/规模化能力，必须人为构造"会走到缝"的数据（装满的 team store / 2 clone / 合成大语料）。退化数据下空壳不可见。
- **facet 坍缩检查**：多个分散 small/medium finding 出现 → 问"是不是同一根因的 facet"。碎片化 + defer 会把单一 HIGH 根因伪装成几个可推后的小洞。

> 实证：fulltest 34/34 surface census 全绿，恰恰因为壳会响应；deeptest 跑 round-trip（team store 61条 → recall 0命中）才坍出 HIGH 根因。

---

## 4. Census 先于 narrowing（广度纪律）

- 每轮先确认**声明面全集**已枚举（运行时从各声明源 grep 抽 inventory：CLI 命令 / MCP tool / schema enum / config key / 数据面路径 / hook surface / env var…）。
- 断言每 surface ∈ {journey} ∪ {parity} ∪ {waiver}，新增无覆盖自动 red。
- 源清单是**开放 data**（census 模式吸收长尾），不手维护穷举（必漂移）。

---

## 5. Verify-before-trust（候选 ≠ finding）

- 发现器零验证，产出全是**候选**。每条先过 deterministic verify（grep/read/tsc/test）。
- refuted 丢弃但**记 reason**（防 reimplemented-noop / 防把 refuted 当 gap 反向膨胀矩阵）。
- confirmed 才进 findings[]，spawn 修复 task。

---

## 6. Frame-challenge 机制 ★ 方法论的已知上限

**多-LLM 收敛 = frame 内自洽 ≠ 正确。critic 只能 frame 内审计，只有 human 能挑战 frame。**

- 任何"多-LLM 都说收敛"的判定，**必须配一道 human frame 挑战**："整个 frame 是不是偏了？有没有一整类没被任何镜头看到的东西？"
- 实证：8 轮 critic 判 converged，全在 CLI-偏向 frame 内；用户一句"实际 agent 交互没被模拟"掀翻 frame → 揭示漏了整条交互轴。
- 收敛裁决：多-LLM dry（连续 K 轮无新 distinct gap）**AND** human frame 挑战通过，才算真收敛。

---

## 7. 统一收口律（三轴各会撞一次"再来一个 instance"）

critic 持续找"再来一个 instance"时，解**不是更多 instance**，是把 instance 当 data 吸收的**生成式 pattern**：
- 深度 → anchor 引用（不编码签名）
- 广度 → census（从声明点抽 + 断言，不手列清单）
- 交互 → taxonomy + rubric，维度**锚外部公认框架**（如 HAX 18），完备性 by-reference 非逐轮发现。

→ 锚外部有限框架，维度集可判完备（无"第 N+1 个维度"无底洞）。

---

## 8. 可模拟性分层（诚实标边界）

- **L-DET**：纯数据/CLI/API，test-wall fixture 全模拟 → "0 用户全闭环"成立。
- **L-LLM**：依赖 LLM 语义判断的行为（分类/触发/cold-start 感知/语义冲突）→ 半模拟，走 nightly LLM-eval，**不能假装确定性模拟**。
- 可观测性 = (journey × 埋点状态) 的函数：T1-ledger（现成）/ T2（补埋点后）/ T3（永远只能 LLM-judge）。**加事件能把 T3 体验下沉到 T1/T2 可复盘**。

---

## 9. 收敛引擎（loop-until-dry，非 score 收敛）

- 每轮：census → 取 oracle 发现候选 → verify → confirmed 进 findings → 修/记。
- **连续 2 轮无新 distinct confirmed finding 才收敛**（不是分数不动就停）。
- 裁决三级：① AI 自决(deterministic) → ② 多-LLM(≥2 独立票 + ≥1 零上下文冷评) → ③ human(兜底)。

---

## 10. Anti-bloat / 可移植性

- 行为型判分，**不编码会随码漂移的具体签名**（install flag 名/JSON 字段名/导出形态交给 tsc/test）。
- 方法论须对**任意项目**可执行，不绑 Fabric 专有结构 —— 镜头(oracle)和纪律是通用的，具体声明源是项目的 data。

---

## Anti-pattern 速查
深度轴逐签名无限钻 · 手维护穷举 surface 清单 · 拿命名例子打死面 · 只查 surface 响应不查 round-trip(放过 scaffolding) · 退化数据下测跨缝能力 · facet 碎片化掩盖单一根因 · 信多-LLM 收敛=正确(frame 须 human 挑战) · 把未自验 candidate 当 gap · 体验维度逐轮发现不锚外部框架 · 假装 L-LLM 行为能纯确定性模拟。
