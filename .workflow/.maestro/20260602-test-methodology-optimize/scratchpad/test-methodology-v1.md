# 全面测试方法论 v1（problem-discovery oriented）

> 目的：给一个 AI agent 一份可独立执行的方法论，使其对一个软件项目做"全面测试/审计"时，**系统地暴露出所有有嫌疑的问题** —— 已知 bug / 疑似 bug / 任何可疑点 / 功能做了但没接入(空壳) / 漏做了。
> v1 变更（Round 1 多-LLM quorum 采纳）：+Phase 0 历史先验 census(D1) · 强化 round-trip 防误报三面(D4) · invariant 可执行注入矩阵(D2) · census 补外部 spec anti-join(D5) · refuted-ledger+LIBERAL capture+多轮统计(D3) · frame 挑战配边界暴露 artifact(X1)。

---

## 0. 一句话纲领
全面 ≠ "把每条已知功能跑一遍看对不对"。全面 = **历史先验 × 三轴覆盖 × 四 oracle 发现 × round-trip 防假绿/防误报 × frame 可被挑战**，跑到 loop-until-dry 收敛。

---

## Phase 0. 历史先验 census（发现 loop 的第 0 步）★ v1 新增（D1）
**在任何 oracle 发现前，先消费项目已有知识** —— issue tracker / changelog / commit log / KB / 已知 pitfalls / 过往 postmortem。
- **用途 (a)** 已知项 = 回测锚：别重新发现，直接验"是否仍在/已修/regression"。
- **用途 (b)** 历史 pitfall 指示**高风险区域**，优先 census。
- 缺这步 = 对"只能从历史上下文浮出"的 known issue 结构性失明。

---

## 1. 三轴覆盖（缺一轴 = 有结构盲区）

| 轴 | 验什么 | 失败模式 |
|---|---|---|
| **深度（grounded）** | 每条 journey 真能跑、指向真实 anchor | over-fit：逐签名无底钻 |
| **广度（surface×lifecycle×persona）** | 声明面全集 × 生命周期 × 角色，每格 has-journey/N-A/GAP | 拿命名例子打死面 |
| **交互（agent-in-the-loop）** | 产品对 live agent 行为的真实影响（MCP/skill/hook delta/预算/策略遵守） | mock 掉 agent，漏验交互价值 |

> 深度收口：强制 grounding + 指向真实 anchor，签名交给 tsc/test-run，别编进方法论（随码漂移）。

---

## 2. 四 Oracle 发现器（oracle 驱动，非凭空想）

| Oracle | 找什么 | search recipe | 真案例 |
|---|---|---|---|
| **producer-consumer** | 写了没人读 / 回路没接通 | grep 能力的 consumer 数（**搜索边界见 §3.A**） | F-MULTISTORE-UNWIRED |
| **declared-vs-impl** | 声明面在但实现是壳 / vocab 不一致 | schema enum vs config 引用值；命令声称 vs 实际 exec | F-MATURITY-ENDORSED / F-SYNC-NOPUSH |
| **doc-vs-code** | 文档/注释/help ≠ 代码 | README/help/注释 vs 实现体 | sync 注释"pushes"实则零 push |
| **invariant** | 恒成立性质被破坏 | **注入矩阵见 §3.D** | F-SCALE-LAT / F-NARROW-BUDGET |

> 不要用"8-perspective quality-smell"镜头做广度发现 —— 结构性漏掉一致性/接线 bug。

---

## 3. 发现器执行细则（v1 强化重灾区）

### 3.A producer-consumer 搜索边界 ★ v1 新增（D4-a，防模板 producer 误报）
符号级查 consumer 必须**跨全部 producer 可能被消费的位置**，不止 `src/`：
- 含 `.cjs`/模板/build 脚本/运行时动态注册表/config/生成物/`.claude` `.codex` `.cursor` 等客户端资产目录。
- 限定 `src/` 搜索会把"接在模板里的 producer"（如 hook surface emit）误报成零消费空壳。
- 判 `consumer=0` 前必须证明"已搜遍所有消费形态"（静态 import + 动态注册 + 字符串引用 + 模板内联）。

### 3.B Round-trip 防假绿（反 scaffolding 铁律）+ 防误报
**空壳缺陷不是"行为错"，是"接线空"。** scaffolding 会：命令报 success、surface census 查到响应、行为测试跑通 —— "行为测试" frame 内全绿。缺陷只在 round-trip 问题下暴露。

**强制律**：对每个声明能力，配 **producer→consumer 回路断言** —— "producer 写进去的，consumer 能真读出来吗？"
- **造触发条件**：跨 store/跨 client/规模化能力，必须人为构造"会走到缝"的数据（装满 team store / 2 clone / 合成大语料）。退化数据下空壳不可见。
- **追到终端副作用** ★ v1 新增（D4，gemini）：回路断言不止查第一层 consumer 存在，要追数据流到**终端真实副作用**（持久化落盘 / 真网络包 / 最终 UI 渲染 / 下游可观测输出）。接到"废弃的/不作为的假消费者(黑洞)"= 仍是空壳。
- **facet 坍缩检查**：多个分散 finding → 问"是不是同一根因 facet"。碎片化+defer 会把单一 HIGH 根因伪装成几个小洞。

### 3.C Round-trip 判空壳前的三道排除 ★ v1 新增（D4-b/c，防误报，精确率核心）
round-trip **不是二元 pass/fail**。判"空壳/未接线"前依次排除：
1. **gated feature + fallback**：该能力是否被 feature flag/条件 gate（默认 off）守卫且有 fallback？是 → 切 enabled 配置再测，**gated-but-wired ≠ hollow**（防 vector-retrieval 误报）。
2. **runtime-empty vs structural-hollow**：回路失败是"物理接线但 runtime 无数据"（造数据后能通 → 非空壳，防知识图谱边误报）还是"consumer 根本不 import/不存在"（造多少数据都不通 → 真空壳）？必须追问是哪一种。
3. **dead code ≠ hollow**：零抛出点/零引用的死代码 + 无对应声明 surface = 死代码，**不是"做了没接入的空壳"**（防 ResolverNotImplementedError 误报）。

### 3.D invariant 可执行注入矩阵 ★ v1 新增（D2，逐类非 ad-hoc）
| 类 | 注入动作 | 抓的 |
|---|---|---|
| 文件损坏 | corrupt/truncate/empty 关键文件(meta/jsonl/md) | F-FAIL-METATHROW |
| 缺失 | 删 config/meta/必需字段 | F9 类 |
| 环境降级 | offline/网络不可达/磁盘满 | sync 降级 |
| **locale** | 切非英文 locale → 验错误分类/i18n 健壮 | **F-SYNC-OFFLINE-I18N** |
| 规模 | 10/100/1000/2000 阶梯语料 | F-SCALE-LAT / F-NARROW-BUDGET |
| 并发 | 2 clone / race / 多 session | 并发污染 |
| 权限 | read-only 目录/文件 | 优雅降级 |

每类至少一次注入 + 观测：是优雅降级(好)还是裸错/静默损坏(bug)。

---

## 4. Census 先于 narrowing（广度纪律）+ 外部 spec anti-join

- 每轮先确认**声明面全集**已枚举：运行时从各声明源 grep 抽 inventory（CLI / MCP tool / schema enum / config key / 数据面路径 / hook surface / env var…）。
- 断言每 surface ∈ {journey} ∪ {parity} ∪ {waiver}，新增无覆盖自动 red。
- 源清单是**开放 data**（census 模式吸收长尾），不手维护穷举。
- **外部 spec anti-join** ★ v1 新增（D5）：code-resident census 只能抓"声明了但实现空"，抓不到"零 footprint 的完全漏做"。补一条 —— 把代码 census **⟕ 外部需求源**（PRD / issue / changelog / 设计文档 / 动态注册表逆推）做 anti-join，**只在外部 spec 而不在代码的 = 漏做候选**。

---

## 5. Verify-before-trust（候选 ≠ finding）+ refuted-ledger + LIBERAL capture

- 发现器零验证，产出全是**候选**。每条先过 deterministic verify（grep/read/tsc/test）。
- **refuted-ledger artifact** ★ v1 强化（D3）：refuted 不是"丢弃"，登记进 refuted-ledger（id + reason + 证据），保留假阳性调查史 → 防重复调查 + 防把 refuted 当 gap 反向膨胀。
- **LIBERAL capture** ★ v1 新增（D3）：弱信号 / 异常但暂不可证的可疑点也先登记候选（标 `unverified`），别在 verify 前丢。"任何有嫌疑的都先记"。
- **非确定性失败多轮统计** ★ v1 新增（D3/gemini）：L-LLM 语义/概率性失效（如 cite 遵循率、触发率），单次 verify **不能**当假阳性丢，须多轮采样看统计显著性。
- confirmed 才进 findings[]，spawn 修复 task。

---

## 6. Frame-challenge 机制 ★ 方法论的已知上限（X1 强化）

**多-LLM 收敛 = frame 内自洽 ≠ 正确。critic 只能 frame 内审计，只有 human 能挑战 frame。**
- 任何"多-LLM 都说收敛"，**必须配 human frame 挑战**："整个 frame 是不是偏了？有没有一整类没被任何镜头看到的东西？"
- **边界暴露 artifact** ★ v1 新增（X1/agy，防 rubber-stamp）：frame 挑战前产一份"盲区清单" —— 本轮未审目录 / skip 的测试 / 未触发的 surface / 隐式系统边界 / 未覆盖的 persona。让 human 对着清单挑战，而非空泛问"还有啥漏的"。
- 收敛裁决：多-LLM dry（连续 K 轮无新 distinct gap）**AND** human 对边界暴露 artifact 挑战通过。

---

## 7. 统一收口律（三轴各会撞一次"再来一个 instance"）

critic 持续找"再来一个 instance"时，解**不是更多 instance**，是把 instance 当 data 吸收的**生成式 pattern**：
- 深度 → anchor 引用（不编码签名）
- 广度 → census（从声明点抽 + 断言，不手列清单）
- 交互 → taxonomy + rubric，维度**锚外部公认框架**（如 HAX 18），完备性 by-reference。
→ 锚外部有限框架，维度集可判完备。

---

## 8. 可模拟性分层（诚实标边界）

- **L-DET**：纯数据/CLI/API → "0 用户全闭环"成立。
- **L-LLM**：依赖 LLM 语义判断（分类/触发/cold-start 感知/语义冲突）→ 半模拟，走 nightly LLM-eval + 多轮统计，**不假装确定性模拟**。
- 可观测性 = (journey × 埋点状态)：T1-ledger（现成）/ T2（补埋点后）/ T3（永远 LLM-judge）。加事件能把 T3 下沉 T1/T2。

---

## 9. 收敛引擎（loop-until-dry，非 score 收敛）

- 每轮：Phase 0 历史 census → census 全集（含外部 anti-join）→ 取 oracle 发现候选 → 3.A-3.D 细则 → verify(+refuted-ledger) → confirmed 进 findings → 修/记。
- **连续 2 轮无新 distinct confirmed finding 才收敛** + human frame 挑战通过。
- 裁决三级：① AI 自决(deterministic) → ② 多-LLM(≥2 独立票 + ≥1 零上下文冷评) → ③ human(兜底)。

---

## 10. Anti-bloat / 可移植性

- 行为型判分，**不编码会漂移的签名**（flag 名/字段名/导出形态交给 tsc/test）。
- 对**任意项目**可执行：oracle 和纪律通用，具体声明源是项目 data。
- 工具假设保持中立（tsc/test-run 是举例，非绑定 TS/JS）。

---

## Anti-pattern 速查
跳过 Phase 0 历史 census 重新发现已知 · 深度轴逐签名无限钻 · 手维护穷举 surface 清单 · 拿命名例子打死面 · 只查 surface 响应不查 round-trip · **consumer 搜索只限 src/(漏模板 producer)** · **把 gated/runtime-empty/死代码误报成空壳** · 退化数据下测跨缝能力 · facet 碎片化掩盖根因 · 信多-LLM 收敛=正确 · frame 挑战 rubber-stamp(无边界暴露 artifact) · refuted 直接丢弃不留痕 · 弱信号 verify 前丢 · 非确定性失败单次当假阳性 · 体验维度逐轮发现不锚外部框架 · census 只 code-resident 漏零-footprint 漏做。
