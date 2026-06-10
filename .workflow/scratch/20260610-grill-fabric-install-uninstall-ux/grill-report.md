# Grill Report: fabric install / uninstall 体验优化

**Session**: 20260610-grill-fabric-install-uninstall-ux
**Depth**: standard (6 concerns → branch-mapped)
**Date**: 2026-06-10
**Upstream**: 用户 6 条 install/uninstall UX 观察

## Discovery Summary（code-grounded）

每条 concern 都先对照代码核验,结论如下(✅=与代码一致 / ⚠️=部分成立 / ❌=与代码矛盾):

### C1 语义搜索启用交互 — ⚠️ 成立(promise/reality 落差 + 硬编码)
- `packages/cli/src/install/pipeline/guidance.stage.ts:101` `promptSemanticSearch`:只问 Yes/No,prompt 文案 `"Enable vector semantic search? (downloads an embedding model on first use)"` 暗示"自动下载"。
- 实际选 Yes 后 `enableSemanticSearch` 只翻 `fabric.config.json` 的 `embed_enabled/embed_model`(`semantic-search.ts:40`),**真正的 `npm i -g fastembed` + 预热缓存全靠用户手动**,CLI 从不代跑(`semantic-search.ts:11` 注释明说 "network/host actions we never auto-run")。
- `renderSemanticSearchInstructions`(`semantic-search.ts:75`)返回 7 行**硬编码中文**说明墙,不走 `t()`,无 fastembed 是否已装的探测,无"要不要我帮你跑"的 offer。
- 落差点:文案承诺自动 → 现实三步手动;说明墙长且不可执行。

### C2 安装后文案 + 客户端能力表 — ❌ 前提与代码矛盾(关键)
- 你的判断:"实际支持 CC CLI / CC Desktop / Codex CLI / **Codex Desktop**,可不写 Cursor"。
- **代码真相**(`packages/cli/src/config/writer.ts:1` ClientKind union + `resolver.ts:99-160`):实现的客户端恰好 4 个 —
  `ClaudeCodeCLI` / `ClaudeCodeDesktop` / **`Cursor`** / `CodexCLI`。
  - **全仓库没有任何 "Codex Desktop" writer/kind**(grep 零命中)。
  - **Cursor 是真实现的**:`bootstrap:true mcp:true`,有 `CursorWriter`(`json.ts:359`)、detect `.cursor/`。
- 反而 Cursor 的能力 flag 被**低报**:resolver 里 Cursor `hook:false skill:false`,但你自己的记忆 `reference_cursor_supports_skills` 证实 Cursor 完整支持 skills → 这是潜在 bug,方向与"删 Cursor"相反。
- 文案不一致(非 store-only 导致,是历史漂移):
  - `restart-banner`(zh-CN:967):"Claude Code / Cursor / Codex CLI"
  - `next-steps`(zh-CN:968):"重启你的 AI 客户端 (Claude Code / Codex)" — 漏 Cursor、漏 Desktop。
  - 三处客户端枚举各说各话。

### C3 uninstall 不镜像 install / phase 不显示 — ⚠️ 部分成立
- uninstall **有** 3-stage pipeline(scaffold/bootstrap/mcp,`uninstall.ts:280`),每 stage 打 `formatUninstallStageHeader`("Next: <stage>",`uninstall.ts:773`)+ 结尾 summary note(removed/skipped/errors)。
- 真正缺的对称性:
  - install 有结尾 capability 表 + `next-steps` 引导 + restart-banner;**uninstall 收尾啥引导都没有**。
  - install stage header 有 labeled phase 输出(`install-stage-output.ts:16`);uninstall 的 "Next: x" 视觉很弱。
  - 非 wizard 交互路径**无 upfront 的"将执行这 3 个 phase"预览**(只有 `--dry-run` 或 wizard 才打 plan summary)。

### C4 personal store 不问 URL / 缺 clone-or-new — ✅ 成立
- `ensurePersonalStore`(`store.stage.ts:265`):无 personal store 时**静默 `initStore` 新建本地空 store**,不 prompt、不问 remote。
- team store 反而有 `promptStoreOnboarding`(`store.stage.ts:209`)给 skip/**join(clone from url)**/create。
- 你的记忆 `reference_env_backup_repo`:你跨电脑备份 ~/.fabric → "从 remote clone 我已有的 personal store" 是真实有价值的流程,当前完全缺失。

### C5 中英夹杂不友好 — ✅ 成立(根因=三套输出源 localization 不一致)
- 三种来源混在一个 session:
  1. `t()` 路由(locale-aware,当前 zh-CN):capability 表、next-steps。
  2. **硬编码中文**:`renderSemanticSearchInstructions` / `enableSemanticSearchAndReport`(`guidance.stage.ts:92`)。
  3. **硬编码英文**:store.stage 全部交互 prompt("Set up a team / shared knowledge store…"、"bound store…")+ "Enable vector semantic search?"。
- 即便在 `t()` 的 zh-CN 串里,英文术语(bootstrap/MCP/hook/skill/surface/recall/embed_enabled)无 glossary 直接夹入 → 无英文概念基础的读者难懂。

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | C2 客户端集合真相对齐 | ✅ locked | 5 client:保留4+新建Codex Desktop+修文案+补Cursor flag | Codex Desktop MCP config 写入路径待核验 |
| 2 | C4 personal store clone-or-new | ✅ locked | wizard 加 personal clone-or-new prompt,默认新建本地 | - |
| 3 | C1 语义搜索交互 | ✅ locked | 探测 fastembed→未装 offer 代跑(consent)→拒绝回退说明;权重仍惰性;改 prompt 文案 | - |
| 4 | C5 i18n 统一策略 | ✅ locked | 全硬编码 prompt 收进 t() + 英文术语首现加 gloss + 跟随 fabric_language | gloss 术语清单 |
| 5 | C3 uninstall 对称性 | ✅ locked | 补收尾引导 + upfront phase 预览 + 对齐 stage 输出格式 | - |

---

## Q&A Log

### Q1 (C2): 客户端集合真相 — 用户判断与代码冲突如何裁?
**矛盾**: 用户称"加 Codex Desktop / 删 Cursor";代码 `writer.ts:1`+`resolver.ts` 实现 4 client(含 Cursor,无 Codex Desktop)。
**Answer**: 用户提供代码外证据——**已实测 Codex Desktop 支持 MCP**。裁决反转为:保留全部 4 个 + **新建 Codex Desktop writer**(5 client),修三处文案客户端枚举不一致,补 Cursor `skill/hook` capability flag(当前 resolver 误标 false)。
**Evidence**: `resolver.ts:127-138`(Cursor flag false,与 memory `reference_cursor_supports_skills` 矛盾→修正);`resolver.ts` 无 Codex Desktop 项(新增)。
**Decision**: locked。
**Constraint**: capability 表/文案 MUST 枚举 5 client 一致;Cursor capability `skill` MUST = true;新增 CodexDesktop writer 前 MUST 核验其可写 MCP config 入口。

### Q2 (C4): personal store 无 remote-clone 路径
**Answer**: wizard 交互且无 personal store 时加 clone-or-new prompt,默认值=新建本地(Enter 跳过);非交互/已存在 personal 时不问。
**Evidence**: `store.stage.ts:265` `ensurePersonalStore` 当前静默 `initStore`;team 侧 `promptStoreOnboarding:209` 已有 join/create 范式可复用;memory `reference_env_backup_repo`=跨机备份 ~/.fabric。
**Decision**: locked。
**Constraint**: personal clone-or-new MUST 仅在 wizardEnabled && 无 personal store 时触发,default 必须是 new-local(零额外按键即原行为)。

### Q3 (C1): 语义搜索 promise/reality 落差
**Answer**: 探测 fastembed 是否可 resolve;已装跳说明墙;未装交互 confirm offer 代跑 `npm i -g fastembed`,拒绝/非交互回退打印说明;模型权重下载保持首次 recall 惰性;prompt 文案去掉"自动下载"暗示。
**Evidence**: `guidance.stage.ts:101` prompt 文案;`semantic-search.ts:11` "never auto-run" 边界→改为 "never without consent";`renderSemanticSearchInstructions:75` 7 行说明墙。
**Decision**: locked。
**Constraint**: 代跑 `npm i -g fastembed` MUST 经显式 consent;权重下载 MUST NOT 在安装期;说明墙仅作 fallback。

### Q4 (C5): 三套输出源 localization 不一致
**Answer**: 全硬编码 prompt(store.stage / semantic)收进 `t()` 双语 locale;不可避免英文术语首现加括号中文 gloss;全程跟随 `fabric_language`。
**Evidence**: 硬编码中文 `guidance.stage.ts:92`+`semantic-search.ts:77-84`;硬编码英文 `store.stage.ts:177/215/229`。
**Decision**: locked。
**Constraint**: install/uninstall 交互文本 MUST 经 `t()`;受保护英文术语首现 MUST 带中文 gloss。

### Q5 (C3): uninstall 对称性
**Answer**: 补 install 式收尾引导 + 非 dry-run 也打 upfront phase 预览 + stage 输出格式对齐 install。
**Evidence**: install `install-stage-output.ts` 有 labeled header+summary+capability 表+next-steps;uninstall `uninstall.ts:773` 仅 "Next: x"+removed/skipped 计数,无收尾引导。
**Decision**: locked。

---

## Synthesis

### Verified Constraints (→ implementation)
- **C2-1** 客户端集合 = 5(CC CLI / CC Desktop / Cursor / Codex CLI / **Codex Desktop[新]**);三处文案枚举统一。
- **C2-2** Cursor capability `skill`/`hook` flag 修正(false→true,接 memory `reference_cursor_supports_skills`)。
- **C2-3** 新增 `CodexDesktopWriter` + resolver 项 + ClientKind union 扩展;**前置核验其 MCP config 路径**。
- **C4-1** wizard 加 personal clone-or-new(default new-local)。
- **C1-1** semantic search:探测→consent offer 代跑→回退;权重惰性;prompt 文案修正。
- **C5-1** 硬编码 prompt 全收 `t()` + 术语 gloss + 跟随 `fabric_language`。
- **C3-1** uninstall 收尾引导 + phase 预览 + stage 格式对齐。

### Risk Register
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | Codex Desktop 的可写 MCP config 入口未在代码核验(仅用户实测) | C2 | high | 实现首步先定位其 config 文件路径 + detect 逻辑,失败则降级为不声明该 client |
| R2 | 删 Cursor 的最初冲动若被误执行会移除已工作客户端 | C2 | med | 已裁决保留;实现时不得动 Cursor 接线 |
| R3 | i18n 全量收 t() 改动面大,可能漏键导致运行期 missing-key | C5 | med | 收键时同步补 en+zh-CN 两 locale,跑 i18n 完整性 gate |
| R4 | offer 代跑 npm 触碰 host,违背原"never auto-run"边界 | C1 | low | 显式 consent + 非交互默认不跑,边界改为 "never without consent" |
| R5 | personal clone-or-new 若 default 误设非 new-local 会拖慢 happy path | C4 | low | default MUST new-local,零额外按键 |

### Recommended Next Step
分两类落地:C1/C3/C4/C5 是**文案+交互修复**(同一 install/uninstall 模块,可一批);C2 含**新建 CodexDesktopWriter**(新功能,需先核验 config 路径)。建议先核验 Codex Desktop config 入口,再走 execute。

