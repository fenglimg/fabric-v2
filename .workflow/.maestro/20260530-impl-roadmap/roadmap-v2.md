# Fabric v2.1 全局多 store 重构 — 实现 Roadmap v2

> Source: `.workflow/.maestro/20260529-global-refactor-impact/status.json`（审计 66 surface / 7 维度 design-complete）
> v2 changelog（应用 round-1 cross-LLM 冷评 gemini 78 / codex 73）：①补 S11 ②测试基建置顶 Phase 0.5 ③install 事务/receipt/错误恢复并入 P3 ④secret-scan/跨store lint 前移写路径前 ⑤拆 P5→P5 治理端侧/P6 性能观测 ⑥修隐私矛盾(共享库绝不含 personal) ⑦解散"跨 phase 桶"逐个落点 ⑧P0 升为 ProjectRootResolver+StoreResolver+Schema ⑨修 S14/S29 回指
> 排序原则：**ProjectRoot/StoreResolver + 测试基建 first**；clean-slate（S22）；每 phase 回指 surface + 可验 done_when。

---

## Phase 0 — ProjectRootResolver + StoreResolver + Schema（第一锚，阻塞全部）

**目标**：把"项目根解析 + 多 store/scope/身份/读写"落成 schema 与两个权威 resolver，后续件只问它、不自己猜。

- **ProjectRootResolver（多信号，S15/S32/S45）**：`env FABRIC_PROJECT_ROOT > 向上探 .fabric/fabric-config.json marker > cwd > repo marker`；一仓一 .fabric 一 project_id（S32）；worktree 靠 project_id 归并（S45）
- **uid 来源（S33）**：全局 config 字段（默认 git user.email 规范化 hash）
- **scope 过滤 / read-set（S11 + S54）**：cwd→project_id+uid → 计算适用档集合 = 项目 required_stores ∪ 隐式 personal 库（**显式接住 S11**，不读未声明 store）
- **StoreResolver 契约**：projectRoot → `read-set`(S11/S54) / `write-target` 分层(S60) / store alias+UUID(S55) / 缺失 store warnings(S51)
- **store identity（S55/S59）**：intrinsic UUID 存 store git 内，remote 仅 locator；config `required_stores:[{id, suggested_remote|$personal}]`（S59/B3）
- **schema**：scope 开放坐标字符串 + entry metadata（`semantic_scope`+`visibility_store`，非目录层级，supersede 旧 S23）→ S20/S23/A3；stable_id per-store(UUID ns)+per-uid（S27）；store 布局同构 `~/.fabric/stores/<uuid>/knowledge/<type>/`+`bindings/`+`state/`（S42/A2）

**done_when**：两 resolver 给定 fixture 输入产出正确 read-set/write-target/projectRoot（含 env/marker/cwd/repo 四信号 golden case 过）；4 schema 过 zod；同构布局可被 reader 识别。
**风险前置**：改 shared schema 必 rebuild dist。

## Phase 0.5 — 验证基建（NEW，前置；冷评一致要求）

**目标**：在碰任何全局 HOME/git/store 之前先有隔离测试环境，否则后续开发污染真实 `~/.fabric`。

- 临时 HOME（隔离 `~/.fabric`）+ `FABRIC_PROJECT_ROOT` 注入（S39）
- fake bare git remote（本地）测 sync/clone（S39）
- 三端 config fixture 各一份（S39）
- **old-layout negative test**（旧 in-repo .fabric 布局 reader 不认 → clean-slate S22/S66 边界验收）
- read-set / write-target / projectRoot golden cases（锚 Phase 0）

**done_when**：上述 fixture + golden 跑通，CI 在隔离 HOME 下绿；旧布局 negative test 确认不读。
**依赖**：Phase 0（schema/resolver 形态）。

## Phase 1 — 多 store 存储 + git 核心

**目标**：N 平行 git store 物理模型，默认折叠单 store。

- 多 store 挂载，各自 .git/remote/凭证/ACL；默认折叠单 default（local-only OK，url 非强制）→ S42/S12/A2
- store⊥scope：共享库=team+project（**绝不含 personal**）；个人库=personal-global+per-project（无 team）；v1 单 team→多 project，org 延后 → S42/A2/#3
- 知识 body 全移出项目 git（项目 repo 无知识 md）→ S2
- events 只放 `~/.fabric/state/` local-only 盖 store+project 戳（不进任何 store git）→ S43/S58
- agents.meta gitignore + 确定性 rebuild → S18
- 凭证 git 原生 per-repo（SSH host alias），不建 profile → A4
- **legacy 过渡边界（S22/S66）**：disk reader 只认新布局；旧 in-repo 知识用户手动搬；不写自动迁移（clean-slate）

**done_when**：空 default store init + 挂多 store + 跨 store 读不混；events 不进 store git；旧布局确认不读（接 Phase 0.5 negative test）。
**依赖**：Phase 0/0.5。

## Phase 2 — MCP 工具契约 + resolution + 写路径防泄漏

**目标**：6 工具 store 边界对 AI 可见；写路径上线**同时**带防泄漏。

- fab_recall/plan_context：read-set 召回，每条带 store_uuid+alias+local_id+global_ref，selection_token 绑 store-set，shadowing 不静默合并 → S61/F1
- fab_get_sections：store-qualified id（裸 id 仅唯一命中兼容）→ S61
- fab_archive_scan/extract：写 active write store + 回显 written_to_store → S61/F1
- fab_review：聚合 read-set 各 writable store pending → S61
- resolution 引擎：scope 双轴(S21)+store tie-break(S53)；required store 不可用显式告警不静默降级 → F2；去重保留来源(S61)
- MCP server cwd→project 行为（接 Phase 0 ProjectRootResolver）→ S15
- **写路径防泄漏（前移，不留 P5）**：secret-scan 入 archive viability gate（S26）+ 跨 store 硬引用 lint（公开库不引私有库，S49）—— 在 archive/extract 写工具上线**之前**就位

**done_when**：6 工具 schema 带 provenance/store-qualified；resolution 双轴+tie-break 可解释；secret-scan + 跨 store lint 拦截生效（有 negative test）。
**依赖**：Phase 0/0.5/1。

## Phase 3 — CLI 命令面 + install 事务（含 receipt/回滚/恢复）

**目标**：装/配/跑/查 闭合；install/sync **自带**事务安全，不留 P5。

- install 二分：`fabric install --global <url>` / `fabric install`（per-repo）→ S4/S8/S24（per-repo 注册约束）
- **install 事务（并入 P3，非 P5）**：plan/apply/verify/rollback + **install-receipt**（S1/S28）+ 注册 merge 保留自定义 + 非法 JSON/TOML abort（S34）+ 错误恢复（半安装/push rejected，S36）
- store lifecycle：`store list/add/remove/bind/switch-write/explain`，**detach≠delete** → S57/E4/S7
- fabric sync：多 store 遍历 + **冲突/离线降冲突自带**（rebase --continue/--abort，离线写本地后 push，S9/S17/S37）
- status/scope-explain/whoami → S30/F5；doctor：drift 引导修复(S10)+rebuild(S18)+refresh-registrations+`--debug-bundle`(默认不含 events)(S47/S58)
- project_id 绑定 UUID（remote hash 仅建议）+ clone 检测缺失 required_stores 引导挂载 → S13/S51
- relevance_paths 项目根相对路径 + doctor 提示失效（S19）；kb-diff / review-export 供项目 PR 互链（S25）

**done_when**（拆细可验）：`install --global`/`install`/`store add·bind·switch-write·explain`/`sync --continue·--abort`/clone 缺 store 引导/非法 config abort/install 中断 rollback —— 逐条有集成测试过（在 Phase 0.5 fixture 下）。
**依赖**：Phase 0/0.5/1/2。

## Phase 4 — Skills + Hooks 改造

**目标**：扩展件 store-aware；hook 不解析 store、不带可执行代码。

- cite policy：`KB: <store-alias>:<id>`（alias 用户自定/canonical，底层 UUID）；personal-only cite 进团队产物**强 warning**（接 P2 写路径）→ S62/F3
- 3 skill：archive(写 active write store+回显) / review(per-store + promotion draft-gen，promotion 走普通 git commit) / import(显式目标 store) → S66/S50/E7
- 新 fabric-sync skill：AI 辅助冲突 + 多 store 遍历 → S46
- 3 hook：SessionStart(store 标签分组+global_ref) / PreToolUse(store-aware hint) / Stop(per-store backlog 不聚合) → S63/S66/F4
- hook 契约：不自解析 store，调 CLI JSON 或读 CLI 预生成 `~/.fabric/state/bindings/<id>_resolved.json`，缺失无害降级；**store 绝不可带可执行 hook（RCE 防线）** → S65
- AGENTS.md 拆：共同策略抽全局 + 项目瘦 stub @ 引用 → S44/S3
- 核心 skill 工具内置全局装三端（Cursor skill 对等）；**store 自带 domain skill v1 defer** → S65/S14/S29/E6

**done_when**：3 skill+3 hook+sync skill store-aware；cite 带 store 前缀；hook 走 CLI/快照不直读 .fabric；store 投影无可执行 hook。
**依赖**：Phase 0/2/3。

## Phase 5 — 治理 + 端侧对齐

**目标**：审计追踪、隐私边界、三端 parity、渲染。

- 治理：audit-trail 复用 events（S26 的 gate 部分已在 P2）；CR/promotion 流程
- **隐私边界（修 v1 矛盾）**：**共享库只有 team+project scope，绝不含 personal**；个人信息只在 personal 库；git author/commit 不匿名是另一明确取舍（匿名提交=future）→ R5-RATIFY#3
- 三端 parity：skill/hook/mcp 三端对等（Cursor 有 skill）+ **hook 行为语义矩阵**（事件名/payload/cwd/session-id 差异）→ S14/S29/S6
- 渲染：纯文本/markdown 三端最小集（S41）；多语言按项目级 fabric_language（S38）

**done_when**：secret-scan/lint 已在 P2 上线（此处只接审计追踪）；三端 parity 矩阵验证；隐私边界 negative test（personal 不进共享库）。
**依赖**：Phase 1-4。

## Phase 6 — 性能硬化 + 观测

**目标**：大库不退化 + 失败可观测。

- 性能：description_index + contextCache 复用 + scope/store 分区分片 + 限 read-set 不全扫；**全局 index 本机私有不同步** → S40
- 观测：install/sync/hook/MCP 失败统一 trace + `doctor --debug-bundle`（默认不含 events，redaction）→ S35
- local-only store：doctor **主动推荐加 git remote 备份**（偏 git 管理，非阻塞）→ R5-RATIFY#5

**done_when**：大库 recall/grep 限 read-set 不全扫（有 perf 基线）；失败有 trace；local-only 库有 remote nudge。
**依赖**：Phase 1-5。

---

## Deferred（不在 v1，scope 开放可后加）
- store 自带 domain skill 投影/清理生命周期 → S48/S52/S56/S65（skill 管理立项后）
- org/多 team/联邦 nesting → scope 开放字符串可扩不改引擎 → S20
- 真私有 personal overlay（*.local.md/.gitignore）→ S31
- 跨同 host 多账号凭证强隔离 profile → S42

## Surface 覆盖核对（66 surface → phase，无"跨 phase 桶"，逐个落点）

- **P0**: S11·S13(config 部分)·S15·S20·S23·S27·S32·S33·S42·S45·S54·S55·S59·S60·A2/A3/A4
- **P0.5**: S39·S22(negative)
- **P1**: S2·S12·S16·S18·S42(物理)·S43·S58·S66(legacy 边界)
- **P2**: S15(MCP cwd)·S21·S26(gate)·S49·S53·S61·F1·F2
- **P3**: S1·S4·S5·S8·S9·S10·S13(project_id)·S17·S19·S24·S25·S28·S30·S34·S36·S37·S47·S51·S57·S7·F5
- **P4**: S3·S14·S29·S44·S46·S50·S62·S63·S64·S65·S66(改造)·E6/E7·F3·F4
- **P5**: S6·S26(trail)·S38·S41·S49(已P2)·R5#3
- **P6**: S35·S40·R5#5
- **Deferred**: S31·S48·S52·S56
- 核对：S1-S66 全部落点，S11 已补，无裸"跨 phase"。
