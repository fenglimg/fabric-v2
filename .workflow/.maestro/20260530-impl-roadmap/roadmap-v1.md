# Fabric v2.1 全局多 store 重构 — 实现 Roadmap v1

> Source: `.workflow/.maestro/20260529-global-refactor-impact/status.json`（审计 66 surface / 7 维度 design-complete）
> 排序原则: **StoreResolver-first**（codex 实现锚）→ schema/解析 → 存储 → MCP 契约 → CLI → skills/hooks → 治理/硬化
> clean-slate（无自动迁移 S22）；每 phase 回指 surface id。

---

## Phase 0 — Schema + StoreResolver 地基（第一锚，阻塞全部后续）

**目标**：把"多 store + scope + 身份 + 读写解析"落成 schema 与一个权威解析器，后续所有件只问它。

- **StoreResolver 契约**：输入 projectRoot → 输出 `read-set` / `write-target` / store alias+UUID / 缺失 store warnings（codex 实现锚）→ 覆 S54/S60/S55/S51
- **store identity**：intrinsic UUID 存 store git 内（`.fabric-store-id`），remote 仅 locator → S55/S59
- **scope = 开放坐标字符串** + entry metadata（`semantic_scope` + `visibility_store`），**非目录层级**（supersede 旧 S23 scope-outer）→ S20/S23/A3
- **stable_id** = per-store(UUID ns) + per-uid，推翻全局单调 counter → S27/D1
- **fabric-config schema**：`required_stores:[{id, suggested_remote|$personal}]` + `active_write_store`（分层默认）→ S13/S51/S59/S60/B3
- **store 布局**：`~/.fabric/stores/<uuid>/knowledge/<type>/` 同构 + `bindings/<project-id>.json` + `state/`（A2 同构）→ S42/A2

**done_when**：StoreResolver 契约 + 4 个 schema（fabric-config / store-id / stable-id / scope）定稿且通过 zod 校验；同构布局落盘可被 disk reader 识别。
**依赖**：无（地基）。**风险前置**：改 shared schema 必 rebuild dist（[[feedback_shared_rebuild_on_schema_change]]）。

## Phase 1 — 多 store 存储 + git 核心

**目标**：N 个平行 git store 物理模型跑起来，默认折叠单 store。

- **多 store 挂载**：`~/.fabric/stores/<uuid>/` 各自 .git/remote/凭证/ACL；默认折叠单 `default`（local-only OK，url 非强制）→ S42/S12/A2
- **store ⊥ scope**：共享库=team+project（无 personal）；个人库=personal-global+per-project（无 team）；v1 固定单 team→多 project，org 延后 → S42/A2/#3
- **events**：只放 `~/.fabric/state/`（任何 store git 外，防误 commit）local-only 盖 store+project 戳 → S43/S58/E8
- **派生态**：agents.meta gitignore + 确定性 rebuild（doctor）→ S18
- **凭证**：git 原生 per-repo（SSH host alias），不建 profile → S42/A4

**done_when**：能 `git init` 空 default store + 挂多 store + 跨 store 读不混；events 不进任何 store git。
**依赖**：Phase 0。

## Phase 2 — MCP 工具契约（store-aware / provenance）

**目标**：6 个 fab_* 工具 store 边界对 AI 可见。

- **fab_recall / fab_plan_context**：按 read-set 召回，每条带 `store_uuid+alias+local_id+global_ref`，selection_token 绑 store-set；shadowing 不静默合并 → S61/F1/S49
- **fab_get_knowledge_sections**：入参 store-qualified id（裸 id 仅唯一命中兼容）→ S61/S66
- **fab_archive_scan / fab_extract**：写 active write store + 返回 `written_to_store` 回显消黑盒 → S61/S66/F1
- **fab_review**：聚合 read-set 各 writable store pending 带 store ns → S61/S66
- **resolution 引擎**：scope 双轴（相关性+binding 权威 S21）+ store tie-break（project-bound 优先 S53）；required store 不可用显式告警不静默降级 → S21/S53/F2
- **去重不等价**：相似项保留来源（team 规范≠个人习惯）→ S61

**done_when**：6 工具返回/入参 schema 带 provenance + store-qualified；resolution 双轴+store tie-break 可解释。
**依赖**：Phase 0/1。

## Phase 3 — CLI 命令面

**目标**：装/配/跑/查 命令面闭合（three-entry）。

- **install 二分**：`fabric install --global <url>`（机器级）vs `fabric install`（per-repo，校验全局+注册+写 config）→ S4/S8
- **store lifecycle**：`fabric store list/add/remove/bind/switch-write/explain`；**detach≠delete** → S57/E4/S7（砍删库机器，要删自行 rm）
- **fabric sync**：多 store 遍历 pull --rebase/push，hook 只 nudge 不自动 push → S9/S30
- **status / scope-explain / whoami**：effective read-set + write-target + 解析来源 → S30/F5
- **doctor**：drift 引导修复（rename S10）+ rebuild reconcile（S18）+ 并入 refresh-registrations + `--debug-bundle`（默认不含 events）→ S10/S47/S58
- **project_id 绑定**：UUID（remote hash 仅建议）；clone 检测缺失 required_stores 引导挂载；worktree 靠 project_id 归并；一仓一 .fabric 一 project_id → S13/S51/S45/S32
- **config 合并**：保留用户自定义，非法 JSON/TOML abort 提示 → S34

**done_when**：全命令面可跑通装/绑/同步/查；clone 到新机能引导补 store。
**依赖**：Phase 0/1/2。

## Phase 4 — Skills + Hooks 改造

**目标**：扩展件 store-aware，hook 不碰 store 解析、不带可执行代码。

- **cite policy**：`KB: <store-alias>:<id>`（alias 用户自定/canonical，底层 UUID）；personal-only cite 进团队产物强 warning → S62/F3/F2
- **3 skill 改造**：archive（写 active write store+回显）/ review（per-store + promotion draft-gen，promotion 走普通 git commit）/ import（显式目标 store）→ S66/S50/E7
- **新 fabric-sync skill**：AI 辅助冲突解决 + 多 store 遍历 → S46
- **3 hook 改造**：SessionStart（store 标签分组+global_ref）/ PreToolUse（store-aware hint）/ Stop（per-store backlog 不聚合）→ S63/S66/F4
- **hook 契约**：hook 不自解析 store，调 CLI JSON 或读 CLI 预生成 `~/.fabric/state/bindings/<id>_resolved.json`；缺失无害降级不阻塞；**store 绝不可带可执行 hook（RCE 防线）** → S65
- **AGENTS.md 拆**：跨项目共同策略抽全局，项目留瘦 stub @ 引用 → S44/S3
- **核心 skill 工具内置**：archive/review/import/sync 全局装三端（Cursor skill 对等）；**store 自带 domain skill 概念 v1 defer** → S65/S14/S29/E6

**done_when**：3 skill+3 hook+新 sync skill 全 store-aware；cite 带 store 前缀；hook 走 CLI/快照不直读 .fabric。
**依赖**：Phase 0/2/3。

## Phase 5 — 治理 / 跨端 / 硬化 / 测试

**目标**：安全、可观测、三端、性能、测试基建补齐。

- **治理**：secret-scan 入 archive viability gate + audit-trail 复用 events；跨 store 硬引用 lint（公开库不引私有库）→ S26/S49
- **隐私边界**：共享库不含个人信息=仅正文+personal scope（git author 不洗，匿名提交=future）→ R5-RATIFY#3
- **三端**：skill/hook/mcp 三端对等（Cursor 有 skill）+ hook 行为语义矩阵（事件名/payload/cwd/session-id 差异）→ S14/S29/S6
- **渲染**：纯文本/markdown 三端最小集（不做富渲染）；多语言按项目级 fabric_language → S41/S38
- **性能**：description_index + contextCache 复用 + scope/store 分区分片 + 限 read-set 不全扫；全局 index 本机私有不同步 → S40
- **离线 / 错误恢复**：git 原生离线 + sync 状态机（--continue/--abort）；半安装事务 rollback；push rejected 提示 → S37/S36/S28
- **local-only 备份**：doctor 主动推荐加 git remote 备份（偏 git 管理，非阻塞）→ R5-RATIFY#5
- **测试基建**：临时 HOME 隔离 + fake bare remote + 三端 config fixture → S39

**done_when**：secret-scan/lint/三端 parity/性能分片/测试 fixture 全落地。
**依赖**：Phase 0-4。

---

## Deferred（明确不在 v1，scope 开放可后加）

- store 自带 domain skill 投影/清理生命周期 → S48/S52/S56/S65（skill 管理立项后）
- org/多 team/联邦 nesting → scope 开放字符串可扩不改引擎 → S20/northstar
- 真私有 personal overlay（*.local.md / .gitignore）→ S31
- 跨同 host 多账号凭证强隔离 profile → S42（git 原生够用时不做）

## Surface 覆盖核对（66 surface → phase）

P0: S20·S23·S27·S42·S54·S55·S59·S60·S51·S13(部分) | P1: S12·S18·S22·S43·S58 | P2: S21·S49·S53·S61 | P3: S4·S8·S9·S10·S30·S32·S34·S45·S47·S57·S7 | P4: S3·S14·S29·S44·S46·S50·S62·S63·S64·S65·S66·S52(defer)·S56(defer)·S48(defer) | P5: S6·S26·S28·S33·S36·S37·S38·S39·S40·S41·S25·S31(defer)·S35·S17 | 跨 phase: S1·S2·S5·S15·S16·S19·S24（已被上述子项吸收，round1 待冷评核对是否有遗漏）
