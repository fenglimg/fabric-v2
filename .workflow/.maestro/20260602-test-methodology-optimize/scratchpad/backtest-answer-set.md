# 回测答案集（methodology backtest ground truth）

> 来源：本会话三 session（fulltest / deeptest / hollow-audit）的已 verify findings。
> 用法：评一份方法论时问 —— "按这份方法论冷跑，能不能**重现** CONFIRMED 这些，且**不复活** REFUTED 这些？"
> CONFIRMED 召回 = 发现力；REFUTED 不误报 = 精确（verify-before-trust）。
> ⚠️ 注意：当前 HEAD 已修了一部分（F9 已修 / multistore 接线已 merge）。**live 盲回测须 pin 到 pre-fix 提交**（如 origin/main `87ac7ae` 或更早）；本答案集用于「设计冷评」(覆盖审计)即可不 pin。

## CONFIRMED — 方法论应能重现（按 oracle 分类）

### producer-consumer（写了没人读 / 回路没接通）★ 最考验方法论
- **F-MULTISTORE-UNWIRED**（HIGH）：multi-store 三处全未接线 —— 写侧从不写 store / recall 读侧 server 零 import store 层 / sync 零 push。实证：team store 61 条，recall 0 命中。**根因级，要靠 round-trip + 造数据(装满 store)才浮**。
- **F1/F2/F3**（hollow-audit，同根 facet）：readKnowledgeAcrossStores 等三函数零消费者 / sync 仅 pull 零 push / store 写面与 server 读面物理断开。
- **F14**（medium）：store list 标 local_only 源自 config metadata 非真实 git remote。
- **F-SYNC-REMOTE**（medium）：store create --remote 只写 config 不 git remote add。

### declared-vs-impl（声明在，实现是壳 / vocab 不一致）
- **F-SYNC-NOPUSH**（HIGH）：sync 声称 pull+push，实际只 pull，报 synced 却本地 1-ahead 永不外传。
- **F-MATURITY-ENDORSED**（low）：config 引 orphan_demote_endorsed_days，schema enum[draft/verified/proven] 拒 endorsed → 静默 skip。
- **F9**（medium，已修）：install 从不写 project_id → status 对已装项目误报 "(not a Fabric project)"。
- **F8/F11/F18/F10**（fulltest 4 confirmed func-bug，已修）：版本门假阳性 / zh-CN-hybrid placeholder / get_sections 文档漏参 / scope-explain 裸 stacktrace。

### invariant（恒成立性质被破坏：规模/边界/降级）
- **F-SCALE-LAT**（medium）：planContext O(N) 全候选遍历，recall 延迟线性 748ms@1000/2802ms@2000。
- **F-NARROW-BUDGET**（medium）：narrow path-anchored 条目未获选择优先级，大语料下被密集 broad 挤出候选池（BM25 输）。
- **F-FAIL-METATHROW**（low）：corrupt/missing agents.meta → recall re-throw 无 remediation 指引。
- **F-SYNC-OFFLINE-I18N**（low）：offline 分类 regex 仅匹配英文 git 错误，本地化错误漏分类。

### doc-vs-code / 交互轴
- **F13**（low）：must_read_if 默认镜像 summary，仅作者显式写才区分（confirmed-as-design）。
- **F-SKILL-PROGRESSIVE**（medium）：progressive disclosure skill 可遵循性依赖 agent 真 load ref 链接（交互轴风险）。
- **cite 遵循 2.5%**（efficacy 弱）：cite policy 首行契约执行者实证违反。

## REFUTED — 方法论应**正确驳回**（不该报成 bug）
> 误报这些 = 精确率失分 = 没做 verify-before-trust。
- **F5 / F15 / F17**（fulltest，自验 refuted）
- **F1-dual-root**（fulltest，dual-root 假设错）/ **F6 / F7**（自愈类）/ **F2 子claim**
- **scope-explain.ts**（29行=真 wrapper 非空壳）
- **project-root-resolver.ts**（已实现真 precedence 逻辑）
- **ResolverNotImplementedError**（死代码，零抛出点，非空壳）
- **hook_surface_emitted**（producer 在 .cjs 模板里，grep 只搜 src 会误判）
- **vector-retrieval**（被 plan-context.ts 真消费，有意 gated 在 embed_enabled off + 完整 fallback）
- **知识图谱边**（已接线，runtime 无数据 ≠ 结构壳）
- **4 MCP tool**（review/extract/archive-scan/knowledge-sections 全 import 真 service）

## 评分锚（给裁判用）
- **召回**：CONFIRMED 中被方法论"能浮出"的比例；root-cause 类（F-MULTISTORE-UNWIRED）权重最高。
- **精确**：REFUTED 中被方法论"正确驳回/要求自验"的比例；陷阱项（hook_surface 模板 producer / vector gated）尤其考验。
- **第一遍 vs 多轮**：北极星是**第一遍冷跑**就抓到 root-cause 类，而非靠 human 掀 frame 多轮。
