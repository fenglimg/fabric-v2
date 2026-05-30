# Goal Checklist — Fabric v2.1 全局化重构影响面发掘

> **真源是 `status.json`,本文件是投影视图。** mode ② 审计驱动。
> 终止判据:6 个 ship_criteria 门全绿(每维度收敛 + 决策锁定 + cross-LLM 完备性批判无遗漏)。

## 目标

在「单一 git 库 + 全局 `~/.fabric` + 项目瘦绑定 + 开放 scope 阶梯(个人/项目/团队,预留多团队/组织)」**已锁定架构**前提下,多轮审计出完整影响面清单 + 设计决策树。

## 边界契约

- **In**:发掘锁定架构落地的全部影响面,每条配决策方向(标注「倾向 vs 已锁」)。
- **Out**:重选架构候选(上个 mode④ 已收敛)、写实现代码(归后续 ① maestro)、预建 org/联邦。
- **Constraints**:Hook=reminder 不阻塞 · Boundary B 不扩 UI · clean-slate 不写迁移 · CLI 能交互别 flag · 仅 CC/Cursor/Codex 三端。

## 6 个验收门(ship_criteria) — ✅ 全绿(2026-05-29)

- [x] **G-SCOPE-FUNC** D1 项目内 .fabric 职能边界 — S1 S2 S3 S13 S25
- [x] **G-INSTALL** D2 mcp/skill/hook 安装管理 — S4 S5 S6 S24 S28 S29 S34
- [x] **G-GLOBAL-LOCAL** D3 全局vs局部关系与切换 — S4 S7 S8 S12 S16 S31 S33
- [x] **G-CLI** D4 CLI 交互命令 — S7 S9 S10 S11 S12 S13 S30 S32
- [x] **G-CLIENT** D5 CC/Codex/Cursor 客户端差异 — S6 S14 S15 S29 S41
- [x] **G-OTHER** D6 其他横切影响 — S16-S22 S26 S27 S35 S36 S37 S38 S39 S40

> **收敛达成**:2 轮 mode② 审计,41 条 surface 全锁向 + verified;round2 cross-LLM(gemini+codex 零上下文)双判全 6 维度 **CONVERGED 无遗漏**;codex 抓的 2 硬伤(S1/S28 边界冲突、S21 precedence open)已收口。遗留 1 非阻塞裁决 **S21-precedence**(personal 应否 override team,产品哲学待用户)。

## Round 1 影响面清单(从 northstar/grill 折入,22 条)

> 图例:🔒 倾向决策已较稳(待 cross-LLM 冷评可推翻) · ❓ 未决 gap · ⚖️ 待用户裁决

**D1 职能边界**
- [ ] S1 🔒 项目 .fabric 退化为身份证+引导页(只剩 config + AGENTS.md)
- [ ] S2 🔒 知识 body 全移出项目 repo git 历史
- [ ] S3 🔒 CLAUDE.md @ 引 AGENTS.md 链路保留
- [ ] S13 🔒 project_id 绑定(local install 强制,默认 git remote hash)

**D2 安装管理**
- [ ] S4 🔒 install 二分(--global 机器级 vs per-repo)
- [ ] S5 🔒 harness 约束:hook/MCP 注册必 per-repo(不变式)
- [ ] S6 🔒 skill 全局 / hook 本体全局-注册 per-repo / mcp per-repo

**D3 全局vs局部**
- [ ] S7 ❓ uninstall 语义(g4:局部摘注册 vs 全局删 KB)
- [ ] S8 🔒 全局未装时 per-repo install 前置校验+引导
- [ ] S12 ❓ 首次无团队库 bootstrap(g5:init 空本地全局库)

**D4 CLI 命令**
- [ ] S9 ❓ fabric sync 入口(g1:pull/commit/push,多挂载库分别操作)
- [ ] S10 🔒 project rename 不加命令,手动+doctor 检测
- [ ] S11 ❓ scope 过滤到当前项目(g3:取所属档并集按 rank)

**D5 客户端差异**
- [ ] S14 ❓ 跨客户端注册差异(g6:Codex/Cursor hook/mcp 是否等价 CC)
- [ ] S15 ❓ MCP server 跨客户端 cwd 行为(g8:全局 server 如何知当前项目)

**D6 其他横切**
- [x] **S16 ✅ g9 已决(用户)**:单一 git KB 库装所有档,personal 入库=uid-scoped 共享(非隐私);反转 KT-DEC-0003;tier→repo 解耦降为扩展接口
- [ ] S23 🔶 KB repo 目录布局(scope-外/type-内,沿用 5-type)+ 内容格式 — 推荐已出待确认(S16 子项)
- [ ] S17 ❓ 多窗口并发写全局库(g7)
- [ ] S18 🔒 agents.meta.json 派生进 git 冲突 → gitignore + 本地 rebuild(g2)
- [ ] S19 🔒 path-binding drift → lint-only
- [ ] S20 🔒 scope 开放坐标 supersede 2-enum(stable_id scope 码由路径承载;改 api-contracts/agents-meta/fabric-config)
- [ ] S21 🔒 resolution-merge 引擎(窄覆盖宽 project>personal>team,取所属档并集)
- [ ] S22 🔒 migration clean-slate(不写自动迁移)

## 执行准则(每轮 continue)

1. 优先攻 ❓ 未决 gap(S7/S9/S11/S12/S14/S15/S17)— 这些决策方向还没有。
2. 🔒 倾向项:跑 cross-LLM 冷评(`maestro delegate --to gemini/codex --mode analysis`)验证或推翻,通过则 `verified_at` 落定。
3. ⚖️ S16 用户裁决项:round 末批量浮,不阻塞其余推进。
4. 每维度收敛(连续 1 轮无新 surface)→ 跑完备性批判(「这维度还漏什么」)→ 无新增则该 ship_criteria 落绿。
5. 涌现新 surface → live-ledger 增长(dedup:token 重叠 ≥0.5 挂 parent_id;goal 对齐必填)。
6. drift gate:每 5 task close 自检 direct+indirect 占比 ≥60%。

## Round 1 收敛批判结果(2026-05-29 cross-LLM 双签: gemini + codex 零上下文冷评)

**deterministic 落定 4 条**:S5(三端均支持全局注册, '必 per-repo' premise 修正→选 per-repo 为可靠 cwd 解析)· S14(三端注册矩阵: Cursor 无 skill)· S15(resolveProjectRoot=env??cwd, 烘焙 FABRIC_PROJECT_ROOT)· S20(scope enum 改动点比原列多: +StableIdSchema/formatKnowledgeId/doctor 校验)。
**❓ gap 锁向 5 条**:S7/S9/S11/S12/S17。
**冷评双方共识 → 新增 7 条 surface**:
- S25 code↔KB 关联与项目 PR 可见性(知识离开项目 git 的评审断层)
- S26 知识治理/审计生命周期(review/approve/audit-trail/promotion/secret-scan;codex 标"完全遗漏的新维度")
- **S27 stable_id 跨机器/离线并发唯一性重设计(本轮最关键;file-lock 单机无效→改 per-uid/machine namespace 或 ULID;推翻 KT-DEC-0004 全局单调 counter)**
- S28 install --global 事务性(升级/重装/回滚 + 版本兼容矩阵 + 注册幂等 + install-receipt)
- S29 三端 capability 抽象 + write-flow 降级(Cursor 无 skill 是能力差异)+ hook 行为语义矩阵
- S30 只读状态命令面(fabric status/diff/scope-explain)+ sync 拆状态机
- S31 真私有 personal 子集(private overlay;不反转 S16 默认, 仅加 opt-in 逃生舱)
**就地 refute 修正**:S13(默认 project_id 改生成 UUID, remote hash 仅 suggested)· S17(file-lock SUPERSEDED BY S27)。
**升 needs_adjudication(非阻塞)**:S21-precedence — personal 应否 override team(产品哲学分叉, 待用户裁)。

## Round 2 议程(carry-over)

1. 锁 S25-S31 决策方向 → cross-LLM 复验。
2. 就地应用 6 条软 refine:S6(并入 S28 版本矩阵)/ S7(fabric backup/purge 安全流程)/ S10(guarded rename)/ S15(多信号 project 解析)/ S18(rebuild determinism)/ S19(drift repair 建议)。
3. 补 Tier C 横切 surface(本轮 ceiling 溢出, 显式不丢):monorepo/多 project_id · uid 生命周期 · 配置合并 · observability/telemetry · 错误恢复 · 离线模式 · 多语言渲染优先级 · test fixture 全局化 · perf/cache · 终端 UI 渲染降级。
4. round 末浮 S21-precedence 裁决。
5. 再发 cross-LLM 完备性批判 → 各维度连续 1 轮无新 surface 且每条 verified_at 落定 → 对应 ship_criteria 落绿。

## Resume

续跑:调 `/goal-mode continue`(推进 → 验证 → 更新 status.json → 重检 6 门 + drift)。
当前:**Round 2**,31 条 surface,0 门绿(round1 冷评判定全维度未收敛, 故进 round2)。下一步:锁 S25-S31 + Tier C 决策方向, 再发 cross-LLM 复验收敛。
