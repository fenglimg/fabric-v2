# rc.35 CHANGELOG 闭口草稿

> 这是 W6 closure 的 CHANGELOG.md rc.35 entry 完整版,等 dogfood 完 + Gemini SHIP
> 后,把这段替换掉 CHANGELOG.md 当前 rc.35 entry 的精简版,然后 commit + tag。

---

## [2.0.0-rc.35] - 2026-05-26

rc.35 werewolf-eval-bundle release: 来自 rc.34 真实长跑测评 (`werewolf-eval` 8 天
19535 events baseline,7 batch 抓出 31 个具体问题) 的 P0 lean 8 项 + Batch 7
onboarding 4 项 = 12 TASK + 1 反向 sweep,共 13 commits。Gates 全绿
(cli 727 / server 643 / shared 430,typecheck 0)。无 schema 破坏性变更
(MCP tool prefix `fab_*` + `fab:rule-id` HTML marker 显式 defer 到 rc.36)。

> ⚠️ **BREAKING (functional, not API)** — **rc.30 及以下用户必读**:
>
> rc.31 在 `.fabric/agents.meta.json` schema 上落了 `z.preprocess` singular→plural fix。
> 该修复**已在 rc.31 工程发布**,但 npm-installed rc.30 全局 CLI **没有同步升级**,
> 导致老用户的 hook 在新项目下**100% 静默失效** (P0-9 根因)。
>
> 升级路径 (两步,任一遗漏均无效):
>
> 1. `npm install -g @fenglimg/fabric-cli@latest` — 把全局 `fabric` CLI 升到 rc.35
> 2. 在每个 fabric-managed 项目下重跑 `fabric install` — 把 SKILL.md / hooks / `.fabric/AGENTS.md` 同步到新版本
>
> 详细 checklist 见 [`docs/UPGRADE.md`](./docs/UPGRADE.md)。
>
> 不升级的症状: SessionStart hook 无 banner / fabric-archive Skill 不触发 /
> `fabric doctor` 报全表 ERROR JSON dump。

### Removed
- **`fab` CLI binary alias** (rc.34 TASK-04 clean-slate decision)。`packages/cli/package.json`
  `bin` 字段只保留 `fabric`,删除 `fab`。Fabric 零用户阶段,统一回 `fabric` 主名,
  避免双 alias 在 docs / 用户脚本中持续产生认知摩擦。**注意**: MCP tool prefix
  `fab_*` (fab_plan_context / fab_extract_knowledge / 等) **不在本次清理范围内**,
  仍按原名工作 — 那是 server API surface,blast radius 大,移交 rc.36 单独立项。
  `fab:rule-id` HTML 注释 marker 同理 defer (schema-level contract)。
- **`fabric-init` deprecated skill** (TASK-03 / P2-6)。
  `packages/cli/templates/skills/fabric-init/` 早已删除,但 rc.30 用户的
  `.codex/skills/` / `.claude/skills/` 仍残留副本。`fabric install` 现在调
  `cleanupDeprecatedSkills` 在装新 skills 前 rm -rf 残留目录。

### Added
- **`fabric install --force-skills-only` flag** (TASK-08 / P0-5/6)。新 fast-path
  跳过 bootstrap / mcp / hooks / settings.json merges,只重新刷 3 个 fabric Skill
  模板。用于 SKILL.md description update 场景而不想动用户 customized 的 hooks /
  settings — 降低升级摩擦。未初始化项目报 exit 1 + 引导跑 full install。
- **`fabric doctor --verbose` flag** (TASK-12 / P0-11)。展开 maintainer-audience
  的 actionHint。默认渲染折叠 maintainer 提示 (源码修改类),用户级提示原样显示。
- **Doctor lint `global_cli_outdated`** (TASK-04 / P0-9.b)。spawn `fabric -v` 检测
  全局 CLI 版本,低于 MIN_SUPPORTED (2.0.0-rc.31) 报 manual_error + 双语
  remediation。ENOENT / 解析失败优雅降级 warn。
- **Doctor lint `knowledge_summary_opaque`** (TASK-05 / P0-10.a)。扫 meta.nodes
  的 `description.summary`,> 30% 与 `stable_id` 相等时报 warn (P0-10 audit 实测
  42/43 opaque)。Sample 前 5 opaque id 内联到 message。
- **Hint renderer summary fallback** (TASK-06 / P0-10.b)。broad + narrow 两 hook
  共享 `lib/summary-fallback.cjs`,opaque entry 读 `.fabric/knowledge/<type>/<id>--*.md`
  的 `## Summary` 段第一句作为临时 summary;cache 到 `.fabric/.cache/summary-fallback.json`
  按 revision_hash keyed,避免重复磁盘 IO。
- **PreToolUse → events.jsonl edit_intent_checked** (TASK-07 / P0-2)。narrow hook
  每个 Edit/Write/MultiEdit fire 写一行 `edit_intent_checked` event (`ledger_source: 'hook'`)
  到 `.fabric/events.jsonl`。修复 P0-2 cite infrastructure 死亡 — 此前 18582 turn /
  240 edit / 0 event,contract operator 验证形同虚设。`ledger_source` enum 新增 `"hook"`。
- **docs/USER-QUICKSTART.md** (TASK-10 / P0-15)。88 行 5 分钟版 quickstart:定位 /
  DO-DON'T 表 / 4 步流程图 / werewolf KT-PIT-0001 真实例 / 5 行 troubleshoot。
  README.md 顶部 link 入口。
- **docs/UPGRADE.md** (TASK-02 / P0-9)。rc.30 → rc.35 升级 checklist 短文。

### Changed
- **doctor `agents_meta_invalid` 文案** (TASK-09 / P0-14 cliff #1)。ZodError 不再
  直接 dump JSON 数组 — 分类为 zod/json/other,zod 抽前 3 个 issue 渲染为
  `<path>: <reason>`。globalCli outdated 时优先显升级 hint,而非 schema 详情。
- **bootstrap canonical** (TASK-11 / P0-13 / P1-9)。在 intro 后 / `## 行为规则`
  前注入 `## For Developers` 5 行段,明示这是 AI 策略配置不是 dev onboarding,
  指向 USER-QUICKSTART.md。
- **CHANGELOG rc.34 stamp**。`Unreleased` → `2026-05-26` (memory `project_rc34_shipped.md`
  确认日期)。
- **32 file fabric → fab 文案统一** (TASK-01) — **被 TASK-04 反向 sweep 推翻**。
  历史 commit 仍在 (`d1abc12` → `5bf687d`),最终 repo 状态 `fab <verb>` → `fabric <verb>` (109 files / 616 hits)。

### Fixed
- **rc.34 stale "Unreleased" header** in CHANGELOG.md (附带 TASK-02 修复)。

### Internal
- `packages/server/src/services/doctor.ts` 新增 `MetaInspection.readErrorKind` /
  `readErrorZodIssues` 结构化字段
- `DoctorCheck.audience` / `DoctorIssue.audience` 新可选字段
- 3 个 maintainer-tagged check: `skill_token_budget_exceeded` / `skill_description_quality` /
  `cite_goodhart_pattern`
- 7 个新单元测试文件: deprecated-skills-cleanup, summary-fallback, edit-intent-ledger,
  install-skills-only, doctor-global-cli, doctor-summary-opaque, doctor-meta-error-humanize,
  doctor-audience-tag
- shared schema rebuild 一次性 (`ledger_source` enum 扩 `"hook"`)
- 13 commits 全部 per-task 独立提交,每个含 acceptance 验证

### Deferred to rc.36+
- events.jsonl 信噪比降级 (assistant_turn_observed 拆 `events.heartbeat.jsonl`,
  方案 A 已锁,见 memory `project_events_jsonl_bloat_rc36.md`)
- MCP tool prefix `fab_*` 重命名为 `fabric_*` (跨 AGENTS.md / skill SKILL.md / server 协同)
- `fab:rule-id` HTML 注释 marker 重命名为 `fabric:rule-id` (schema contract)
- 全部 35 doctor check 显式 audience 标 (rc.35 仅标了 3 个 maintainer-only,其余隐式 user default)
- cite_goodhart G1-G5 内部代码 user-facing 重写 (rc.35 fold by default 已遮蔽)
