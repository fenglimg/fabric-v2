# Fabric v2.1 全局多 store 重构 — 实现 Roadmap v4

> Source: `.workflow/.maestro/20260529-global-refactor-impact/status.json`（审计 66 surface / 7 维度 design-complete）
> v4 changelog（应用 round-3 cross-LLM 冷评 gemini 零上下文 ~96 / codex 接地验证锚 ~93）：
> ①**parity-matrix.json 前置 P0**：结构定义入纯定义层(S14/S29 契约), P4 端侧适配有基准、P5 仅执行 E2E 验证 —— 消除"先写代码后对齐"二次倒置(gemini#2)
> ②**P3 补 bindings 快照生成链路**：install/sync/bind applied 阶段显式产 `~/.fabric/state/bindings/<id>_resolved.json`, P4 hook 依赖它(gemini#1)
> ③**P1 补跨 store pending 聚合 API**：N 平行 git 模型显式提供跨库 pending 查询, 作 fab_review(P2) 底层支撑(gemini#3)
> ④删覆盖表臆造 id `S15-mcp` 并回 S15(secondary)(codex#1) ⑤删"P2/P3 可部分并行"取严格拓扑(codex#2) ⑥P0.5 golden 标 xfail/red-suite(codex#3) ⑦S65 P4 限 core runtime/RCE, Deferred 补 S65(domain-skill,secondary)(codex#4)
> 排序原则：**契约(含 parity 矩阵) → 测试墙 → resolver 实现 first**；clean-slate（S22）；每 phase 回指 surface + 可验 done_when。

## 依赖 DAG（执行器按锚点调度，严格拓扑）

```
P0(契约/schema/parity-matrix) → P0.5(测试墙) → P0.6(resolver TDD 实现)
                                                    ↓
                                                P1(多 store + git 核心 + 跨库 pending API)
                                                    ↓
                                                P2(MCP+resolution+防泄漏)
                                                    ↓
                                                P3(CLI+install 事务+bindings 快照)
                                                    ↓
                                                P4(Skills+Hooks)
                                                    ↓
                                                P5(治理+端侧 parity E2E) → P6(性能+观测)
```

无环；唯一关键路径 P0→P0.5→P0.6→P1→P2→P3→P4→P5→P6。P3 严格依赖 P2(不声明并行,避免与 phase 依赖冲突)。

---

## Phase 0 — Schema + Resolver 契约 + parity 矩阵（纯定义层，不碰真实 HOME，阻塞全部）

**目标**：把"项目根解析 + 多 store/scope/身份/读写 + 三端对等"落成 **schema 类型 + 两 resolver 接口契约 + parity 矩阵契约 + golden fixture 规格**。本 phase 只产类型/签名/规格/契约文件,不跑真实 HOME/git —— 实现在 P0.6 TDD、parity 实测在 P5。

- **ProjectRootResolver 契约（多信号，S15/S32/S45）**：定义解析序 `env FABRIC_PROJECT_ROOT > 向上探 .fabric/fabric-config.json marker > cwd > repo marker`；一仓一 .fabric 一 project_id（S32）；worktree 靠 project_id 归并（S45）—— 出**接口 + 四信号 golden case 规格**
- **uid 来源（S33）**：全局 config 字段（默认 git user.email 规范化 hash）—— 出字段 schema
- **scope 过滤 / read-set 契约（S11 + S54）**：cwd→project_id+uid → 适用档集合 = 项目 required_stores ∪ 隐式 personal 库（**显式接住 S11**,不读未声明 store）—— 出 read-set 计算契约 + golden 规格
- **StoreResolver 契约**：projectRoot → `read-set`(S11/S54) / `write-target` 分层(S60) / store alias+UUID(S55) / 缺失 store warnings(S51)
- **store identity（S55/S59）**：intrinsic UUID 存 store git 内,remote 仅 locator；config `required_stores:[{id, suggested_remote|$personal}]`（S59/B3）
- **schema**：scope 开放坐标字符串 + entry metadata（`semantic_scope`+`visibility_store`,非目录层级,supersede 旧 S23）→ S20/S23/A3；stable_id per-store(UUID ns)+per-uid（S27）；store 布局同构 `~/.fabric/stores/<uuid>/knowledge/<type>/`+`bindings/`+`state/`（S42/A2）
- **parity 矩阵契约（前移,S14/S29 契约部分）**：定义 `parity-matrix.json` 结构(每行=一能力 × 三端 CC/Codex/Cursor 期望态)+ 桩数据,作 P4 端侧适配开发基准、P5 E2E 验收数据源 —— 本 phase 只出 schema+桩,**实测在 P5**

**done_when**：4 schema + parity-matrix schema 过 zod 编译；两 resolver TS 接口 + 四信号(env/marker/cwd/repo) golden case **规格文件**写出(JSON fixture 期望值,尚不跑);同构布局类型可被 reader 类型识别；parity-matrix.json 结构定义 + 桩落地。**不要求**真实 HOME 跑通(那是 P0.6)。
**风险前置**：改 shared schema 必 rebuild dist。

## Phase 0.5 — 验证基建（测试墙，第一个可执行件；冷评一致要求前置）

**目标**：在碰任何真实全局 HOME/git/store 之前先有隔离测试环境,resolver 实现(P0.6)直接 TDD 在此墙上,不先写代码再补测试。

- 临时 HOME（隔离 `~/.fabric`）+ `FABRIC_PROJECT_ROOT` 注入（S39）
- fake bare git remote（本地）测 sync/clone（S39）
- 三端 config fixture 各一份（S39）
- **old-layout negative test**（旧 in-repo .fabric 布局 reader 不认 → clean-slate S22/S66 边界验收）
- 把 P0 写出的 read-set / write-target / projectRoot golden **规格**实例化为可跑断言,**标 `xfail`/独立 red-suite**(实现未就绪 → 预期红,作 P0.6 TDD 起点;主 CI 只验证测试墙本身可执行,xfail 不计失败)

**done_when**：隔离 HOME + fake remote + 三端 fixture 就位,主 CI 在隔离 HOME 下绿(golden 断言为 xfail/red-suite,不阻断主 CI);旧布局 negative test 确认不读。
**依赖**：Phase 0（仅 schema/契约类型,非实现）。

## Phase 0.6 — Resolver 实现（TDD，把 P0.5 red-suite 转绿）

**目标**：在 P0.5 测试墙上实现 ProjectRootResolver + StoreResolver,直到 P0 golden case 由 xfail 转全绿。

- 实现四信号 projectRoot 解析(S15/S32/S45)
- 实现 read-set / write-target 计算(S11/S54/S60)、store alias+UUID 解析(S55)、缺失 store warnings(S51)

**done_when**：P0.5 中 read-set/write-target/projectRoot golden case 由 xfail 全部转绿;隔离 HOME 下主 CI 绿。
**依赖**：Phase 0/0.5。

## Phase 1 — 多 store 存储 + git 核心 + 跨库 pending 聚合

**目标**：N 平行 git store 物理模型,默认折叠单 store；提供跨 store 状态聚合底座。

- 多 store 挂载,各自 .git/remote/凭证/ACL；默认折叠单 default（local-only OK,url 非强制）→ S42/S12/A2
- store⊥scope：共享库=team+project（**绝不含 personal**）；个人库=personal-global+per-project（无 team）；v1 单 team→多 project,org 延后 → S42/A2/#3
- 知识 body 全移出项目 git（项目 repo 无知识 md）→ S2
- events 只放 `~/.fabric/state/` local-only 盖 store+project 戳（不进任何 store git）→ S43/S58
- agents.meta gitignore + 确定性 rebuild → S18
- 凭证 git 原生 per-repo（SSH host alias）,不建 profile → A4
- **跨 store pending 聚合 API（前移底座,addr gemini#3）**：N 平行 git 模型显式提供"遍历 read-set 各 writable store 的 pending/draft 查询聚合"原语,作 P2 `fab_review` 聚合 pending 的底层支撑(P2 工具不自己遍历 store git)
- **legacy 过渡边界（S22/S66-legacy）**：disk reader 只认新布局；旧 in-repo 知识用户手动搬；不写自动迁移（clean-slate）

**done_when**：空 default store init + 挂多 store + 跨 store 读不混；events 不进 store git；跨 store pending 聚合 API 给定多 store fixture 返正确合集；旧布局确认不读（接 Phase 0.5 negative test）。
**依赖**：Phase 0.6（resolver 实现就绪）。

## Phase 2 — MCP 工具契约 + resolution + 写路径防泄漏

**目标**：6 工具 store 边界对 AI 可见；写路径上线**同时**带防泄漏。

> **依赖澄清（codex 拓扑核验）**：本 phase 写工具(archive/extract)写入 **P1 默认 store 物理写 + P0/P0.6 write-target resolver**；`fab_review` 聚合 pending 走 **P1 跨 store pending 聚合 API**。不依赖 P3 的 `store add/bind` 多 store CLI;多 store 写目标在 P3 后自然扩展。

- fab_recall/plan_context：read-set 召回,每条带 store_uuid+alias+local_id+global_ref,selection_token 绑 store-set,shadowing 不静默合并 → S61/F1
- fab_get_sections：store-qualified id（裸 id 仅唯一命中兼容）→ S61
- fab_archive_scan/extract：写 active write store(P1 默认库) + 回显 written_to_store → S61/F1
- fab_review：聚合 read-set 各 writable store pending（走 P1 跨 store pending 聚合 API）→ S61
- resolution 引擎：scope 双轴(S21)+store tie-break(S53)；required store 不可用显式告警不静默降级 → F2；去重保留来源(S61)
- MCP server cwd→project 行为（接 Phase 0.6 ProjectRootResolver）→ S15(MCP cwd)
- **写路径防泄漏（前移,不留 P5）**：secret-scan 入 archive viability gate（S26-gate）+ 跨 store 硬引用 lint（公开库不引私有库,S49-lint）—— 在 archive/extract 写工具上线**之前**就位

**done_when**：6 工具 schema 带 provenance/store-qualified；resolution 双轴+tie-break 可解释；secret-scan + 跨 store lint 拦截生效（有 negative test）。
**依赖**：Phase 0.6/1。

## Phase 3 — CLI 命令面 + install 事务（含 receipt/回滚/恢复/bindings 快照）

**目标**：装/配/跑/查 闭合；install/sync **自带**事务安全,不留 P5；产出 hook 依赖的 bindings 快照。

> **实现顺序（codex#4 round2）**：① install transaction(plan/apply/verify/rollback+receipt) → ② store lifecycle(list/add/remove/bind/switch-write/explain) → ③ sync 冲突/离线状态机 → ④ status/scope-explain/whoami/doctor。后件依赖前件就绪。

- install 二分：`fabric install --global <url>` / `fabric install`（per-repo）→ S4/S8/S24（per-repo 注册约束）
- **install 事务**：plan/apply/verify/rollback + **install-receipt**（S1/S28）+ 注册 merge 保留自定义 + 非法 JSON/TOML abort（S34）+ 错误恢复（半安装/push rejected,S36）
- **bindings 快照生成（addr gemini#1）**：install/sync/bind 的 applied 阶段显式生成/更新 `~/.fabric/state/bindings/<id>_resolved.json`(CLI 预生成的已解析绑定),供 P4 hook 无解析直读;有集成验收
- store lifecycle：`store list/add/remove/bind/switch-write/explain`,**detach≠delete** → S57/E4/S7
- fabric sync：多 store 遍历 + **冲突/离线降冲突自带**（rebase --continue/--abort,离线写本地后 push,S9/S17/S37）
- status/scope-explain/whoami → S30/F5；doctor：drift 引导修复(S10)+rebuild(S18)+refresh-registrations+`--debug-bundle`(默认不含 events)(S47/S58)
- project_id 绑定 UUID（remote hash 仅建议）+ clone 检测缺失 required_stores 引导挂载 → S13-projectid/S51
- relevance_paths 项目根相对路径 + doctor 提示失效（S19）；kb-diff / review-export 供项目 PR 互链（S25）

**done_when**（拆细可验）：`install --global`/`install`/`store add·bind·switch-write·explain`/`sync --continue·--abort`/clone 缺 store 引导/非法 config abort/install 中断 rollback —— 逐条有集成测试过（在 Phase 0.5 fixture 下）；**bind/sync 后 `bindings/<id>_resolved.json` 生成且内容与 resolver 解析一致(集成验收)**。
**依赖**：Phase 0.6/1/2。

## Phase 4 — Skills + Hooks 改造

**目标**：扩展件 store-aware；hook 不解析 store、不带可执行代码；端侧适配以 P0 parity-matrix 为基准。

- cite policy：`KB: <store-alias>:<id>`（alias 用户自定/canonical,底层 UUID）；personal-only cite 进团队产物**强 warning**（接 P2 写路径）→ S62/F3
- 3 skill：archive(写 active write store+回显) / review(per-store + promotion draft-gen,promotion 走普通 git commit) / import(显式目标 store) → S66-改造/S50/E7
- 新 fabric-sync skill：AI 辅助冲突 + 多 store 遍历 → S46
- 3 hook：SessionStart(store 标签分组+global_ref) / PreToolUse(store-aware hint) / Stop(per-store backlog 不聚合) → S63/S66-改造/F4
- hook 契约：不自解析 store,调 CLI JSON 或读 CLI 预生成 `~/.fabric/state/bindings/<id>_resolved.json`(由 P3 生成),缺失无害降级；**store 绝不可带可执行 hook（RCE 防线）** → S65(core-runtime)
- AGENTS.md 拆：共同策略抽全局 + 项目瘦 stub @ 引用 → S44/S3
- 核心 skill 工具内置全局装三端（Cursor skill 对等,以 P0 parity-matrix 为基准）；**store 自带 domain skill v1 defer** → S65(domain-skill)→Deferred/S14/S29/E6

**done_when**：3 skill+3 hook+sync skill store-aware；cite 带 store 前缀；hook 走 CLI/快照不直读 .fabric；store 投影无可执行 hook；端侧适配对照 P0 parity-matrix 桩开发(实测在 P5)。
**依赖**：Phase 0/0.6/2/3。

## Phase 5 — 治理 + 端侧对齐

**目标**：审计追踪、隐私边界、三端 parity E2E、渲染。

- 治理：audit-trail 复用 events（S26-trail,gate 部分已在 P2）；CR/promotion 流程
- **隐私边界（修 v1 矛盾）**：**共享库只有 team+project scope,绝不含 personal**；个人信息只在 personal 库；git author/commit 不匿名是另一明确取舍（匿名提交=future）→ R5#3
- 三端 parity：skill/hook/mcp 三端对等（Cursor 有 skill）+ **hook 行为语义矩阵**（事件名/payload/cwd/session-id 差异）→ S14/S29/S6
- 渲染：纯文本/markdown 三端最小集（S41）；多语言按项目级 fabric_language（S38）

**done_when（去虚指）**：
- secret-scan/lint 已在 P2 上线（此处只接审计追踪）
- **三端 parity 由 P0 定义的 `parity-matrix.json` 驱动**（每行=一能力×三端期望态）,验收 = 矩阵 100% E2E 用例绿,非人工"对等"判断(P5 只做执行验证,契约/桩在 P0)
- 隐私边界 negative test：构造含 personal 条目写共享库的输入,断言被拦（personal 不进共享库）

**依赖**：Phase 0(parity 契约)/1-4。

## Phase 6 — 性能硬化 + 观测

**目标**：大库不退化 + 失败可观测。

- 性能：description_index + contextCache 复用 + scope/store 分区分片 + 限 read-set 不全扫；**全局 index 本机私有不同步** → S40
- 观测：install/sync/hook/MCP 失败统一 trace + `doctor --debug-bundle`（默认不含 events,redaction）→ S35
- local-only store：doctor **主动推荐加 git remote 备份**（偏 git 管理,非阻塞）→ R5#5

**done_when（去虚指）**：
- **perf 基线数值阈值**：固定规模大库 fixture(如 1k 条/5 store),recall p95 ≤ 基线×1.2 且不出现全扫(断言扫描条数 ≤ read-set size)
- 失败有 trace（每失败路径有结构化 trace 条目）
- `--debug-bundle` **redaction 样例**：含 secret 的输入产出的 bundle 断言不含明文(negative test)
- local-only 库有 remote nudge（doctor 输出含建议行）

**依赖**：Phase 1-5。

---

## Deferred（不在 v1,scope 开放可后加）
- store 自带 domain skill 投影/清理生命周期 → S48/S52/S56/S65(domain-skill)（skill 管理立项后）
- org/多 team/联邦 nesting → scope 开放字符串可扩不改引擎 → S20
- 真私有 personal overlay（*.local.md/.gitignore）→ S31
- 跨同 host 多账号凭证强隔离 profile → S42

---

## Surface 覆盖核对（66 surface S1-S66 → phase，纯 S* 表）

> 重复落点已标 `(primary)` / `(secondary)`。非 surface 决策/反馈锚见下方独立小节。P0.6 行的 S11/S15/S54/S60 是 P0 契约的实现说明,不计独立落点(codex 提示)。

- **P0（契约/schema/parity）**: S11 · S13(config,primary) · S15(resolver,primary) · S20 · S23 · S27 · S32 · S33 · S42(schema,primary) · S45 · S54 · S55 · S59 · S60 · S14(parity 契约,primary) · S29(parity 契约,primary)
- **P0.5**: S39 · S22(negative,primary) · S66(legacy-negative,secondary)
- **P0.6**: (实现 P0 的 S11/S15/S54/S60 等,不新增独立落点)
- **P1**: S2 · S12 · S16 · S18 · S42(物理,secondary) · S43 · S58 · S66(legacy 边界,secondary)
- **P2**: S15(MCP cwd,secondary) · S21 · S26(gate,primary) · S49(lint,primary) · S53 · S61
- **P3**: S1 · S4 · S5 · S8 · S9 · S10 · S13(project_id,secondary) · S17 · S19 · S24 · S25 · S28 · S30 · S34 · S36 · S37 · S47 · S51 · S57 · S7
- **P4**: S3 · S14(skill,secondary) · S29(skill,secondary) · S44 · S46 · S50 · S62 · S63 · S64 · S65(core-runtime,primary) · S66(改造,primary)
- **P5**: S6 · S26(trail,secondary) · S38 · S41 · S49(已 P2,secondary) · S14(parity E2E,secondary) · S29(parity E2E,secondary)
- **P6**: S35 · S40
- **Deferred**: S31 · S48 · S52 · S56 · S65(domain-skill,secondary)
- 核对：S1-S66 全部落点,S11 已补,无裸"跨 phase",无非 surface id 混入,重复面已标主次。

## 决策/反馈锚 → phase（非 surface，独立追溯）

> 这些是审计的 architecture(A*)/feedback(F*)/extension(E*)/ratify(R5#*) 决策锚,**不计入 66 surface 数**,单列防污染覆盖纯度。

- **A2/A3/A4**（store 布局同构 / scope 坐标 / 凭证 git 原生）→ P0(A3)·P1(A2/A4)
- **F1**（provenance 可见）→ P2 · **F2**（不静默降级）→ P2 · **F3**（store-qualified cite）→ P4 · **F4**（hook store 标签）→ P4 · **F5**（whoami/scope-explain）→ P3
- **E4**（detach≠delete）→ P3 · **E6**（store domain skill）→ Deferred · **E7**（import 显式目标）→ P4
- **R5#3**（隐私边界:共享库不含 personal）→ P5 · **R5#5**（local-only remote nudge）→ P6
