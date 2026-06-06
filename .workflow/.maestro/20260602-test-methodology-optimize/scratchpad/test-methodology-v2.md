# 全面测试方法论 v2（problem-discovery oriented）

> 目的：给一个 AI agent 一份可独立执行的方法论，使其对一个软件项目做"全面测试/审计"时，**系统地暴露出所有有嫌疑的问题** —— 已知 bug / 疑似 bug / 任何可疑点 / 功能做了但没接入(空壳) / 漏做了。
> v1→v2 变更（Round 2 多-LLM quorum 采纳）：round-trip 升级为**契约级等价**(D4 收口原则) · census anti-join 加 **spec staleness/drift 甄别 + 无-spec baseline**(D5,3/3) · L-LLM 多轮统计加**定量阈值**(D3,2/3) · frame 挑战加**可审计 artifact + 诚实标不可约盲区 + 失败回流**(X1,3/3)。

---

## 0. 一句话纲领
全面 ≠ "把每条已知功能跑一遍看对不对"。全面 = **历史先验 × 三轴覆盖 × 四 oracle 发现 × round-trip 契约等价(防假绿/防误报) × frame 可被挑战**，跑到 loop-until-dry 收敛。

---

## Phase 0. 历史先验 census（发现 loop 第 0 步）★ D1
在任何 oracle 发现前，先消费项目已有知识 —— issue tracker / changelog / commit log / KB / 已知 pitfalls / postmortem。
- **(a)** 已知项 = 回测锚：别重新发现，直接验"仍在/已修/regression"。
- **(b)** 历史 pitfall 指示**高风险区域**优先 census。
- 缺这步 = 对"只能从历史上下文浮出"的 known issue 结构性失明。

---

## 1. 三轴覆盖（缺一轴 = 结构盲区）
| 轴 | 验什么 | 失败模式 |
|---|---|---|
| **深度（grounded）** | 每条 journey 真能跑、指向真实 anchor | over-fit：逐签名无底钻 |
| **广度（surface×lifecycle×persona）** | 声明面全集 × 生命周期 × 角色 | 拿命名例子打死面 |
| **交互（agent-in-the-loop）** | 产品对 live agent 行为的真实影响 | mock 掉 agent 漏验交互价值 |
> 深度收口：强制 grounding+真实 anchor，签名交 tsc/test-run。

---

## 2. 四 Oracle 发现器
| Oracle | 找什么 | recipe | 真案例 |
|---|---|---|---|
| **producer-consumer** | 写了没人读 / 读了没人写 / 回路没接通 | grep consumer 数（边界见 §3.A） | F-MULTISTORE-UNWIRED |
| **declared-vs-impl** | 声明在但实现壳 / vocab 不一致 | schema enum vs config；命令声称 vs exec | F-MATURITY-ENDORSED / F-SYNC-NOPUSH |
| **doc-vs-code** | 文档/注释/help ≠ 代码 | README/help/注释 vs 实现体 | sync 注释"pushes"实则零 push |
| **invariant** | 恒成立性质被破坏 | 注入矩阵见 §3.D | F-SCALE-LAT / F-NARROW-BUDGET |
> 不用"8-perspective quality-smell"做广度发现（漏一致性/接线 bug）。

---

## 3. 发现器执行细则（重灾区）

### 3.A producer-consumer 搜索边界 ★ D4-a（防模板 producer 误报）
符号级查 consumer 必须**跨全部 producer 可能被消费的位置**，不止 `src/`：含 `.cjs`/模板/build/运行时动态注册表/config/生成物/`.claude` `.codex` `.cursor` 客户端资产。
- 判 `consumer=0` 前须证明"已搜遍所有消费形态"（静态 import + 动态注册 + 字符串引用 + 模板内联）。
- **静态 grep 动态盲区（诚实标）** ★ v2：动态注册/DI 容器/事件总线/eval 内联的间接调用链，静态 grep 穿不透 → 该类能力的接线判定**降级为 runtime trace**（真跑一次看调用栈），不可仅凭静态 grep 判空壳或判已接线。

### 3.B Round-trip = 契约级等价（不止连通性）★ v2 升级（D4 收口原则）
**空壳缺陷不是"行为错"是"接线空"。** scaffolding 会命令报 success / surface 有响应 / 行为测试跑通，"行为测试" frame 内全绿；缺陷只在 round-trip 暴露。

**强制律**：对每个声明能力配 **producer→consumer 回路断言**，验的是**契约级等价**而非仅"有数据流过"：
1. **连通性**：producer 写进去，consumer 真读出来（造触发数据：装满 store / 2 clone / 合成大语料；退化数据下空壳不可见）。
2. **保真度** ★ v2：consumer 读到的与 producer 写入的**语义等价** —— 字段无静默丢失（schema 升级后反序列化容灾吞字段=隐性 bug 不是 wired）、无类型降级。
3. **新鲜度** ★ v2：consumer 读到的是最新而非陈旧 cache。
4. **双向无悬空** ★ v2：既查"写了没人读"(producer→0 consumer)，也查"读了没人写"(悬空 consumer，依赖永不被生产的数据)。
5. **终端副作用**：追数据流到**终端真实副作用**（落盘/真网络包/最终 UI/下游可观测输出）。接到"废弃/不作为的假消费者(黑洞)"=仍是空壳。
6. **facet 坍缩**：多个分散 finding → 问"同一根因 facet?"，防碎片化掩盖 HIGH 根因。
> 收口说明：上面 2-4 是"契约等价"原则的 instance（字段/时序/方向），不是穷举清单 —— 新冒的同类 instance（如编码/单位/幂等）按本原则吸收，非新 gap。

### 3.C 判空壳前的三道排除 ★ D4-b/c（精确率核心）
round-trip 失败 **不等于** 空壳。判"未接线"前依次排除：
1. **gated feature + fallback**：被 flag/条件 gate（默认 off）守卫且有 fallback？→ 切 enabled 再测，**gated-but-wired ≠ hollow**（防 vector-retrieval 误报）。
2. **runtime-empty vs structural-hollow**：失败是"物理接线但 runtime 无数据"（造数据能通→非空壳，防知识图谱边误报）还是"consumer 不 import/不存在"（造数据也不通→真空壳）？
3. **dead code ≠ hollow**：零引用死代码 + 无对应声明 surface = 死代码，不是"做了没接入"（防 ResolverNotImplementedError 误报）。

### 3.D invariant 可执行注入矩阵 ★ D2（逐类非 ad-hoc）+ teardown
| 类 | 注入 | 抓的 |
|---|---|---|
| 文件损坏 | corrupt/truncate/empty 关键文件 | F-FAIL-METATHROW |
| 缺失 | 删 config/meta/必需字段 | F9 类 |
| 环境降级 | offline/网络不可达/磁盘满 | sync 降级 |
| **locale** | 切非英文 → 验错误分类/i18n | **F-SYNC-OFFLINE-I18N** |
| 规模 | 10/100/1000/2000 阶梯 | F-SCALE-LAT / F-NARROW-BUDGET |
| 并发 | 2 clone / race / 多 session | 并发污染 |
| 权限 | read-only 目录 | 优雅降级 |
- 每类至少一次注入 + 观测：优雅降级(好) vs 裸错/静默损坏(bug)。
- **teardown（诚实标，单票未达 quorum 但低风险纳入）**：破坏性注入须配状态恢复/隔离（临时目录/clone），防状态泄漏污染后续测试产生级联假阳性。

---

## 4. Census 全集 + 外部 spec anti-join + Drift 甄别

- 每轮先枚举**声明面全集**：从声明源 grep 抽 inventory（CLI/MCP/schema enum/config key/数据面/hook surface/env var…）。断言每 surface ∈ {journey}∪{parity}∪{waiver}，新增无覆盖自动 red。源清单是开放 data（census 吸收长尾），不手维护穷举。
- **外部 spec anti-join**（D5）：code-resident census 抓不到"零 footprint 完全漏做" → 把代码 census ⟕ 外部需求源（PRD/issue/changelog/设计文档）anti-join，只在外部 spec 不在代码 = 漏做候选。
- **Spec staleness/drift 甄别** ★ v2 新增（D5，3/3 quorum，防假阳性洪灾）：anti-join 命中**不直接判漏做**，先对外部源做归一化：
  - **status**：active / deprecated / waived / superseded —— 仅 active 才算漏做候选，deprecated/waived 记审计痕不报。
  - **staleness**：源比代码旧很多（如 issue 早于相关重构）→ 降权，标"待人工确认非过期"。
  - **ownership**：无 owner / 无验收标准的 spec 条目降权。
- **无-spec baseline** ★ v2 新增（D5）：对"代码与 spec 皆零 footprint"的隐式/平台级漏做（如缺标准优雅降级、缺常规安全审计、缺错误 remediation），anti-join 失效 → 补一份**通用 baseline-expectations checklist**（每类项目应有的横切能力）兜底比对。

---

## 5. Verify-before-trust（候选≠finding）+ refuted-ledger + LIBERAL + 统计严谨

- 发现器零验证 = **候选**。每条先过 deterministic verify（grep/read/tsc/test）。
- **refuted-ledger**（D3）：refuted 登记（id+reason+证据），保留假阳性调查史，防重复 + 防把 refuted 当 gap。
- **LIBERAL capture**（D3）：弱信号/暂不可证可疑点也先登记（标 `unverified`）—— "任何有嫌疑的先记"。
- **非确定性失败统计严谨** ★ v2 升级（D3，2/3 quorum，防执行者间结论不一致）：L-LLM 语义/概率性失效（cite 遵循率/触发率）不单次判，须定量：
  - **最小样本量**（如 ≥N 次采样）+ **判定阈值**（可接受概率下限/失败率上限）+ **promoted/refuted 决策规则**（越线才 promote 为 finding）。
  - 阈值与样本量写进 finding 证据，使**跨执行者可复现**，不靠主观解释。
- confirmed 才进 findings[]，spawn 修复 task。

---

## 6. Frame-challenge 机制 ★ 方法论的已知上限（X1 升级）

**多-LLM 收敛 = frame 内自洽 ≠ 正确。critic 只能 frame 内审计，只有 human 能挑战 frame。**
- 任何"多-LLM 都说收敛"，**必须配 human frame 挑战**。
- **边界暴露 artifact**（X1）：frame 挑战前产"盲区清单" —— 未审目录 / skip 测试 / 未触发 surface / 隐式边界 / 未覆盖 persona。
- **可审计挑战 artifact** ★ v2 新增（X1,codex）：frame 挑战须留可审计输出 —— 提的挑战问题 / 给的 waiver+理由 / 反驳证据 / pass-fail 结论。空泛"通过"不算，防形式化 rubber-stamp。
- **失败回流** ★ v2 新增（X1,agy）：human 挑战若 fail（指出 frame 偏了）→ 不是终止，是**回流**：把新揭示的维度/盲区加进 exploration_axes，streak 归零重跑。
- **不可约盲区（诚实标）** ★ v2 新增（X1,agy 二阶 rubber-stamp）：边界清单由 agent 自诊断生成，agent 自身的结构性盲区**无法自列**（未识别的目录列不进清单）→ 这是**不可机械化的残差**。正因如此，frame 挑战必须由**真实 human**（带 agent 之外的视角）做，不能用 agent 自生成清单替代。这条限制是 by-design 不是 bug —— 能完全机械化的挑战就已落在 frame 内了。

---

## 7. 统一收口律（三轴各撞一次"再来一个 instance"）
critic 持续找"再来一个 instance"时，解**不是更多 instance**，是把 instance 当 data 吸收的**生成式 pattern**：
- 深度 → anchor 引用（不编码签名）
- 广度 → census（从声明点抽+断言）
- 交互 → taxonomy+rubric，维度锚外部框架（如 HAX 18）
- **round-trip → 契约等价原则**（§3.B，字段/时序/方向是 instance 非清单）★ v2
→ 锚原则/外部框架，维度集可判完备。

---

## 8. 可模拟性分层（诚实标边界）
- **L-DET**：纯数据/CLI/API → "0 用户全闭环"成立。
- **L-LLM**：依赖 LLM 语义判断 → 半模拟，nightly LLM-eval + §5 多轮统计，不假装确定性。
- 可观测性 = (journey × 埋点状态)：T1-ledger/T2(补埋点)/T3(永远 LLM-judge)。加事件把 T3 下沉 T1/T2。

---

## 9. 收敛引擎（loop-until-dry）
- 每轮：Phase 0 历史 census → census 全集(含 anti-join+drift 甄别) → oracle 发现候选 → §3.A-3.D 细则 → verify(+refuted-ledger+统计) → confirmed 进 findings → 修/记。
- **连续 2 轮无新 distinct confirmed finding** + **human frame 挑战(可审计)通过** 才收敛；human 挑战 fail → 失败回流 streak 归零。
- 裁决三级：① AI 自决(deterministic) → ② 多-LLM(≥2 独立票+≥1 零上下文冷评) → ③ human(兜底)。

---

## 10. Anti-bloat / 可移植性
- 行为型判分，**不编码会漂移的签名**。
- 对**任意项目**可执行：oracle 和纪律通用，声明源是项目 data。
- 工具假设中立（tsc/test-run 是举例）。**工具链自举（诚实标，单票）**：执行 deterministic verify 前需一步探针（探测 build/test 命令、构造 mock 的方式）—— 属执行期 bootstrap，方法论不绑定具体工具。

---

## Anti-pattern 速查
跳过 Phase 0 重发现已知 · 深度轴逐签名钻 · 手维护穷举 surface · 拿命名例子打死面 · 只查 surface 响应不查 round-trip · consumer 搜索只限 src/ · **只验连通性不验契约等价(字段静默丢/陈旧cache/悬空消费者)** · 把 gated/runtime-empty/死代码误报空壳 · 静态 grep 判动态接线 · 退化数据测跨缝 · facet 碎片化掩盖根因 · **anti-join 不甄别 spec 过期/waiver 致假阳性洪灾** · 信多-LLM 收敛=正确 · frame 挑战无可审计 artifact(rubber-stamp) · 用 agent 自生成清单替代真 human 挑战 · refuted 不留痕 · 弱信号 verify 前丢 · 非确定性失败单次判(无样本量/阈值) · 体验维度逐轮发现不锚外部框架 · census 只 code-resident 漏零-footprint(无 baseline 兜底)。
