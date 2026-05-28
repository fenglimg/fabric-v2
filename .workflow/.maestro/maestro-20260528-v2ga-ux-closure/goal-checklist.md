# v2.0.0 GA — 用户体验整体闭环 Goal Checklist

> 投影视图，单一真源是 `status.json`。Resume：读本文件取「执行准则/边界契约/子目标」作为行动手册，然后 `/maestro-ralph continue` 推进；严禁手动越界执行 skill。

## 边界契约（Tier 模型 + 9 轮 grill 决议）

- **版本序列**：rc.37 → **rc.38（UX 闭环 RC = 本本全绿；工程本 F2/F3 已 done，仅剩 G4 user-only publish）** → 短 soak → bump v2.0.0 GA。
- **闭环定义**：两本 ledger 所有 **P0/P1** 关闭 + 所有 **floor 硬门**过 + 覆盖 self-audit 0 漏；**P2/P3 显式 defer 到 v2.0.x patch**（≥2 LLM 复核 + 用户批量终审）。
- **ship_criteria 二分**：正确性类（G-GREEN/G-MCP-PAYLOAD/G-COVERAGE）hard-block 必闭；涌现性类（G-CITE/G-ARCHIVE-RECALL/G-DOCTOR-RECOVERY/G-SKILL-TRIGGER）双重出口——达标 or **过 floor + 根因穷尽 + ≥2 LLM 签字 = metric-gap**（不算 defer）；**没过 floor = bug，不许发 rc.38**。
- **客户端**：四优先端开发场景全 full-tier；自动测 2 CLI（Claude/Codex CLI），**Desktop/Cursor GUI = 用户手动 fire-test**（UX-19）。Cursor + Claude Desktop Chat/Cowork tab 缓发。
- **收敛闸**：dogfood NEW-N 带 severity；depth ≤3；总 NEW-N 超 ≈29 告警停报。
- **dogfood 标的**：仓内 fixture 为主（可重放），活 repo 用户手动可选；fresh-eyes 强制 context-clean subagent，≥2 LLM 至少一个零上下文。
- **Out of scope**：新功能 / 基建深度重构 / 自动发版 / S5 周级 + S6 月级长跑 / Codex Desktop 不需新开发（共享 config.toml）。

## Ship Criteria（goal_gate）

| 指标 | 维度 | target | actual | blocking |
|---|---|---|---|---|
| G-MCP-PAYLOAD | D-MCP | 单 path payload ≤ 4k tok（基线 ~11.9k） | ~1.4k ✅ | ✅ |
| G-CITE | D-HOOK | cite-coverage ≥ 30%（baseline 3.1%） | — | ✅ |
| G-ARCHIVE-RECALL | D-SKILL | archive recall ≥ 40%（baseline 20%） | — | ✅ |
| G-SKILL-TRIGGER | D-SKILL | auto-invoke F1 ≥ 71% 无回归 | 100% ✅ | ⬜ |
| G-PARITY | D-PARITY | CC/Codex 5 操作 diff 无 blocking | — | ✅ |
| G-GREEN | D-GREEN | tsc 0 / test 全绿 / lint 0 / doctor green | — | ✅ |
| G-DOCTOR-RECOVERY | D-CLI | 自救率 ≥80%（floor 60%） | — | ✅ |
| G-COVERAGE | meta | 每模块 ≥1 task + 收尾 self-audit 0 漏 | — | ✅ |

> floor 硬门：G-CITE ≥20% / G-ARCHIVE-RECALL ≥30% / G-SKILL-TRIGGER ≥65% / G-DOCTOR-RECOVERY ≥60% —— 没过 floor 不许发 rc.38。

## 子目标（task_decomposition）

### D-MCP — MCP 返回 payload 瘦身（X6，已诊断，可直接动手）
- [x] **UX-1** fold ① 塌缩 per-path index → 单一 candidates（A1 自然收尾，省 ~50%）✅ 5-path ratio 1.08
- [x] **UX-2** fold ② 抑制空壳 entry（~30 条 summary===id 的 legacy draft 噪音）✅ 14 条抑制 + diagnostic
- [x] **UX-3** fold ③ 删死字段（level/required/selectable + description.* 外层重复 + 瘦 requirement_profile）✅
- [x] **UX-4** plan_context payload-size 回归基线锁定 + fab_recall 同步瘦身 ✅ ~1.4k tok 实测
- [x] **UX-13** fab_get_knowledge_sections (step-2 全文拉取) payload audit + MCP 工具报错反馈（并 G3）✅ 删 precedence + de-jargon

### D-SKILL — Skill 效果 + 交互旅程（S3/S5）
- [x] **UX-5** auto-invoke 触发准确度复测（archive/import/review，F1 ≥ 71%，≥2 LLM）✅ F1=100% (claude+gemini 各 22/22) → NEW-1 P3 defer
- [ ] **UX-6** fabric-archive recall dogfood（≥40%）
- [ ] **UX-15** fabric-review + fabric-import 交互旅程 dogfood（不只 trigger）

### D-HOOK — Hook 效能（S4）
- [ ] **UX-7** Hook surface → AI 行为变化验证（SessionStart broad + PreToolUse narrow）
- [ ] **UX-8** cite-coverage ≥30% 复测
- [ ] **UX-9** nudge 频率合适度（archive/review/maintenance，≥2 LLM）

### D-CLI — 用户交互旅程 + 故障自救（S1/S2/S6/S7/S8 + X3）
- [ ] **UX-10** Onboarding cliff 30min self-演复测 + --help 首屏（并 G1，≥2 LLM，builds-on 工程本 F3）
- [ ] **UX-14** doctor 故障自救 dogfood（自救率 ≥80% floor 60% + 次要 mode 输出，并 G2，X3 最大盲区，≥2 LLM）
- [ ] **UX-16** S7 升级 + S8 退出/撤销 UX 冒烟（历史 0% UX 覆盖）

- [x] **UX-18** AGENTS.md 两步协议工效（G5，最高频 AI 交互，P1，≥2 LLM）✅ 修 stale shape + fab_recall 设默认 (claude+gemini SOUND)

### D-PARITY — 跨客户端（X1，per-client 能力面）
- [ ] **UX-11** Claude CLI vs Codex CLI 能力面验证（自动，仅 2 CLI，builds-on 工程本 F2）
- [ ] **UX-19** Claude Desktop Code tab + Codex Desktop 安装正确性 + hook-fire（**manual / 用户手动**，P1）

### D-GREEN — 基建绿灯（Tier B）
- [ ] **UX-12** 绿灯门 + 关键路径冒烟 + config/metrics 可读性（并 G4）

### meta — 覆盖门（保证『及时暴露所有』）
- [ ] **UX-17** surface→task 覆盖映射表 + 收尾 self-audit + ≥2 LLM 交叉协议

## 完成判据

`task_decomposition[*].status` 全 `done`（等价：本文件末尾出现 `ALL_GOALS_DONE`）+ 所有 blocking ship_criteria `verified_at != null`。
