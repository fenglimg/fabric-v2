# Bug-discovery Oracle Catalog (mode② by-prompt 注入清单)

> goal-mode mode② 的「发现原语」输入。把 e2e-methodology-FINAL 的**覆盖地图**补上缺的那一半——**判据(oracle)**。
> 用法: `continue` 单步把下表某一行注入 `/manage-issue-discover by-prompt "<dimension.finding_criteria + search_patterns>"`,
> 产出候选 → 过 goal-mode §5 verify 阶梯(deterministic 先验) → 存活才进 status.json `findings[]`,refuted 丢弃(记 reason)。
>
> **bug = 实际行为 ⊕ 期望**;期望只有 5 个来源。
>
> ### ★ 信任层级(code-as-truth,2026-05-30 用户纠偏)
> **代码是唯一权威真源。文档/KB 可能很久没更新,可信度低。** 故 oracle 按信任分两档:
> - **高信任 = 代码自指**(code-vs-test / producer-consumer / declared-vs-impl / invariant):代码对自己的承诺,不依赖任何外部期望,0 用户可跑,**这是审计主力**。
> - **低信任 = doc-vs-code**:默认判定 = **"文档 stale,更新 KB"**(非"代码 bug")。**仅当代码同时 code-internal 自相矛盾**(如违背自己的 test/type)才升为真 bug。单纯"代码 ≠ 老文档"→ 退役/更新文档,不碰代码。

## 通用 oracle 类型(项目无关,按信任排序)

| 信任 | dimension | finding_criteria(判据) | 抓哪类问题 |
|---|---|---|---|
| **高** | **code-vs-test** | 跑全套 test:failing/skipped/`@ts-ignore`/`as any` = 代码与自己契约矛盾;test 断言 ⟷ 实现对齐 | 真 bug(最强,代码自指) |
| **高** | **producer-consumer** | 生产方 emit 的字段/类型 ⊇ 消费方读取的字段;schema ⟷ 调用方实参;格式声明 ⟷ parser/regex | 功能前后矛盾 |
| **高** | **declared-vs-impl** | 每个被声明能力(命令/flag/tool/skill/hook)有真 handler;孤儿声明 = 未完成 | 功能没完成 |
| **高** | **invariant** | round-trip(写→读=原物)/幂等(跑两次=同态)/单调(counter 永不复用)/引用完整(引用 id 必存在) | 真 bug |
| **低** | **doc-vs-code** | docs/KB/注释的 "never/always/must" 承诺;**默认判 doc-stale**,仅当代码违背自己 test/type 才升 bug | 多为文档漂移(低价值) |

## Fabric/pcf 实例化(本轮 search_patterns + file_patterns)

| dimension | search_patterns | file_patterns | finding_criteria 实例 |
|---|---|---|---|
| declared-vs-impl | `allCommands` object keys · `server.registerTool("...")` 字面量 · `templates/skills/*` 目录 · HOOK_SCRIPT_DESTINATIONS | `packages/cli/src/commands/**` `packages/server/src/tools/**` `packages/cli/templates/**` | 每命令有 `<name>.ts` + `export default`;每 registerTool 与 index.test 断言列表互为子集;每 skill 模板被 install 拷贝 |
| producer-consumer | `event_type ===` / `EVENT_TYPE_*` emit 处 vs reader · zod `z.object`/`z.discriminatedUnion` vs 调用方 · `stable_id` 正则 `K[PT]-(DEC\|MOD\|GLD\|PIT\|PRO)-\d+` | `packages/server/src/services/event-ledger*` `packages/shared/src/schemas/**` | emit 的 event 字段 ⊇ hook/doctor 读的字段;schema 改了必 rebuild dist(见 [[feedback-shared-rebuild]]) |
| doc-vs-code | grep KB/注释 "never block" `exit 2` `exit 1` "no server-side filter" "personal 永不提交" | `packages/cli/templates/hooks/*.cjs` `.fabric/knowledge/decisions/**` `packages/server/src/**` | KT-DEC-0007: hook exit 2+stderr 永不阻塞 · KT-DEC-0003: personal 不进 git · KT-DEC-0004: counter 永不复用 |
| invariant | `archive`/`recall`/`install`/`retire` 入口;`counters.` 写处 | `packages/server/src/tools/**` `packages/cli/src/install/**` | install 两次同态;retire→recall 返空;counter 删条目不释放 slot |

## 防误报护栏(本项目特定,排除"设计意图")

- **NEW-N-1 全库无 `git push`** = 设计(手动 push),非 bug —— 见 [[project-rc-release-log]]
- **KT-DEC-0002 clean-slate 无 v1 迁移** = 设计,缺迁移路径非 bug
- **hidden 命令**(plan-context-hint/onboard-coverage/scope-explain/metrics)= 故意 hidden,cli-surface.test 只断言 public 非 bug(方法论 NEW 附注)
- 任何 finding 实施/上报前 **grep 实证**,防 reimplemented-noop(见 [[feedback-audit-verification]])

## 多-LLM 挖掘协议(2026-05-30 用户要求,挖掘+验证双多-LLM)

每轮 `continue` 发现步 = **跨 LLM fan-out**,而非单代理:
- **挖掘 fan-out**: 同一 oracle dimension 派给多个 LLM 各跑各的(`maestro delegate --to gemini --mode analysis` + `--to codex` run_in_background) + claude 主线 grep。不同 LLM 视角互盲,合并候选去重(同 file:line / >0.5 token 重叠)。
- **验证 fan-out**(§5 阶梯): deterministic 先验(grep/tsc/`pnpm -r exec tsc --noEmit`/跑 test);仍主观/分歧 → ≥2 LLM 冷评(≥1 零上下文),verbatim 采纳 suggested fix;不可逆/越权 → 升 human。
- **delegate 完成判定**: 认权威 `[DELEGATE COMPLETED]` 标记 + 产物计数,别信单代理假完成(见 [[feedback-maestro-delegate-completion-gate]])。

## 轮次预算(loop-until-dry + ceiling)

- **主判据 = loop-until-dry**: 连续 **2** 轮无新 distinct **confirmed** finding 才收敛(refuted/doc-stale 不算 distinct finding)。
- **兜底 ceiling = 8 轮**(budget.max_rounds)。每轮 `round_task_ceiling=12` 候选上限,超额 carry 下一轮。
- 终止后 `terminate_reason ∈ {converged-dry | rounds-exhausted}`。

## ★ 完备性边界:能确保挖净什么(按 oracle 可判定性分类)

> **"挖净所有 bug"理论不可达**(oracle 问题 + Rice 定理 + intensive 不可约)。诚实建模 = 按 oracle 把 bug 拆成可判定/不可判定,各自不同保证级别。

| bug 类 | oracle | 保证 |
|---|---|---|
| 前后不一致(结构): producer/consumer · 声明/实现 | 代码自指,锚点可枚举 | ✅ 可证完备(对 anchor census) |
| 前后**行为**不一致(跨端): 三端 parity | **差分**(同输入→任何 delta=finding) | ✅ 可判定(行为一致性最强工具) |
| code-vs-test 矛盾 | test+tsc | ✅ 可判定且穷举 |
| 缺失功能(已声明未实现) | 声明 census | ✅ 孤儿=grep;"该有却没声明"→❌无 oracle |
| 不变量违反 | 你**枚举**的不变量清单 | ⚠️ 相对清单完备,清单开放 |
| 安全漏洞 | 模式+威胁模型 | ⚠️ 模式类半可判定;逻辑/越权不可判定(STRIDE+多LLM) |
| 逻辑写错(意图在脑里) | 人意图/spec | ❌ 不可判定,只 human review 能保证 |

**可达"确保" = 3 证明 + 1 残差**: ①census 完备(extensive 红绿) ②oracle-类完备(可判定类红绿门) ③多样性饱和(不可判定类 loop-until-dry,是收敛信号非完备证明) ④**残差 ledger 显式记"没覆盖什么"**(未枚举不变量/未 spec 意图/未跑行为交互)——沉默截断=假完备。

## 覆盖保证(extensive,机械红绿;= J-META census 套到 bug 挖掘)

> **两种覆盖,只有 extensive 可证明**:extensive(每单元被审过)=census+partition+reconcile 红绿门;intensive(审过的 bug 都挖到)=不可约,多-LLM+loop-until-dry 压概率,不号称 0。

1. **文件 census(分母)**: `git ls-files 'packages/**/*.ts' 'packages/**/*.cjs' | grep -vE '__tests__|\.test\.|coverage'` → Fabric=**177** 文件。
2. **per-oracle anchor census**(覆盖分母=该 oracle 声明锚点,非全文件): producer-consumer=21 emit 文件 · declared-vs-impl=24 声明 · invariant=13 变更入口 · code-vs-test=177 src vs 194 test。grep 确定性枚举。
3. **partition + 强制回报**: census 切片分派给各 LLM,**每 agent 必返 `files_examined:[...]`**(没扫的不许算覆盖)。LLM "扫了 @packages/**" ≠ 覆盖——覆盖在回报+对账,不在 prompt。
4. **reconcile 覆盖门**: 断言 `union(files_examined) ⊇ census`;差集=缺口→重派。red-until-0-gap。
5. coverage ledger 进 status.json(可检验 artifact,非"希望")。

## Round 实测结果(pcf=Fabric)

**Round-1**(claude 主线 grep,3 oracle):
- declared-vs-impl(命令): 12/12 handler 存在 → clean(oracle 跑通不误报)
- declared-vs-impl(MCP tool): 6 registerTool == index.test 断言 6 → clean
- doc-vs-code(KT-DEC-0007): F1 候选 → **code-as-truth 复验后 REFUTED-as-bug**(code+test 自洽,KT-DEC-0007 stale)→ 降级为 doc-drift(更新 KB,非 bug)

**Round-2+**(待跑,多-LLM): producer-consumer(event_type emit vs reader)· invariant(install 幂等/counter 单调/retire→recall)· code-vs-test(skipped/@ts-ignore/as any 扫)
