# Goal Checklist — Fabric skill 路由器 B2 重构

> status.json 是真源,本文件是投影视图。推进请调 `/goal-mode continue`。

**模式**:① 计划驱动(轻量 ledger) · **终止判据**:`task_decomposition[*].status` 全 `done`(含 A5 验证门)

## 目标
保留 `fabric/` 路由器当人类单一门面,把 Intent Map 表 + `S_CLASSIFY` 枚举改由 `fabric install` 从 7 个 leaf 的 `description` Triggers 子句**生成**(managed block,marker 内严禁手编),从根上消除"改 leaf 忘维护路由器"的 drift。

## 边界契约
**IN**:`install/skills-and-hooks.ts`(SKILL_SPECS + 生成逻辑)· `templates/skills/fabric/SKILL.md`(marker 块)· `server/.../doctor-skill-lints.ts`(chain-ref lint)· `packages/shared`(若需 marker 常量,导出 + rebuild)
**OUT**:不塌缩 8→1 · 不动 leaf 业务逻辑 · 不加 `routing_label` 字段 · 不动 `lib/shared-policy.md` · 不改 S_CHAIN/Guardrails 语义
**约束**:marker 内 install 生成严禁手编(复用 BOOTSTRAP_MARKER 写法)· 源头唯一=leaf description Triggers · 路由器只读不写 store · 收尾必跑 `pnpm -r exec tsc --noEmit` · 动 shared 必 rebuild dist · 每 task done 即 commit

## 任务清单(全 done — 已 completed)
- [x] **A1** fabric/ 加进 SKILL_SPECS(单文件)+ 装两端 + uninstall 对称清理
- [x] **A2** SKILL.md 用 `ROUTER_INTENT_MARKER_BEGIN/END` 圈 Intent Map + 枚举
- [x] **A3** install 写生成逻辑:读 7 leaf description → 抽 slug+Triggers → 重写 marker 块(幂等/两端一致)
- [x] **A4** doctor lint:S_CHAIN 引用的 leaf 名 ∈ SKILL_SPECS,否则报 drift
- [x] **A5** 验证门:`tsc --noEmit` 绿(exit0)+ CLI 1069 / Server 729 test 绿

## 执行准则(行动手册)
1. 先读现状:`SKILL_SPECS`(line ~166-216)、现有 ref/lib 安装逻辑(line ~629/706 可参照)、现有 lint 函数(`inspectSkillRefMirror` 等)作模板。
2. 每个 task:实现 → 跑 deterministic verifier 取证 → 原子更新 status.json(`status=done` + `verified_at`)→ `git commit`。
3. A3 是核心:生成逻辑应在 install 复制 fabric/SKILL.md 后,读 sibling leaf 模板的 description,重写 marker 块;务必幂等(再跑一次内容不变)。
4. 全 task done 后写 `status=completed` + `loop_exit_status` + `[[FINAL_NOTIFICATION]]`。

## Resume
续跑:在本 worktree 调 `/goal-mode continue`。
