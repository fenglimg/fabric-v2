# Fabric Bootstrap

本项目使用 Fabric 管理跨客户端 AI 知识与行为规则。本文件由 `fabric install` 同步到两端 managed block,**不要手动编辑两端的 block**,只改这里 + 重跑 `fabric install`。

## For Developers

这个文件是 **AI 客户端的策略与规约配置**,不是 dev onboarding。你不需要读 Self-archive / Cite / Phase 0.4 等细节。
作为 dev 你只需要:在每个 repo 跑一次 `fabric install`,用 `fabric store bind <alias>` / `fabric store switch-write <alias>` 接入写入 store,出问题跑 `fabric doctor`。
**严禁手动编辑 `.fabric/agents.meta.json`** — 派生状态由 engine 重建。

## 5 分钟上手 (Dev Quickstart)

**Fabric 是什么**:跨客户端(Claude Code / Codex CLI)的 AI 知识层。把团队/项目的 **decisions / pitfalls / guidelines / models / processes** 存为 markdown,hook 自动 surface 给 AI,让 AI 不用每次重学。

**你要做的 (DO)** vs **engine 自动的 (DON'T 手动)**:

| 你 DO | 你 DON'T |
| --- | --- |
| 每个 repo 跑一次 `fabric install` | 手编 `.fabric/agents.meta.json` |
| 异常时跑 `fabric doctor` (--fix 自愈) | 手编 `.claude/hooks/` 下 `.cjs` |
| 用 `fabric-archive` / `fabric-review` / `fabric store ...` 管理 store-backed knowledge | 手写任何非 store knowledge 根 |
| `npm install -g @fenglimg/fabric-cli@latest` 升级 | 背 35 条 doctor lint 代码 |

**4 步循环**: `fabric install` (一次) → 绑定并选择写入 store → AI 正常工作 (hook on session start + edit) → AI 通过 MCP 写入当前 write store 的 pending 条目并返回 `pending_path` → 用 `fabric-review` skill 审核。

**真例**:某 sprite 黑边 root cause 是 `atlas.premultiplyAlpha` flag 反向 — 归档进 store 的 `knowledge/pitfalls/` 后,下次同类问题 AI 自动 reference。

完整 maintainer 版见 `docs/USER-QUICKSTART.md`。

## 行为规则
- **修改任何文件前**:先 `fab_recall(paths=[<被改文件>])` —— 一次调用拿回相关 KB 的描述 + 原生读取路径(`entries[].read_path`)。`fab_recall` 不再投递正文;需要某条正文时直接对其 `entries[].read_path` 做原生 Read(`Read <store>/knowledge/<type>/<id>--*.md`),这会被 PostToolUse hook 记为 `knowledge_body_read`。lean 默认:描述+索引已够发现条目,正文按需读一次,不每轮重灌(KT-GLD-0005)。
- **`.fabric/agents.meta.json` 严禁手动编辑**;engine 会自动同步派生状态,显式 reconcile 跑 `fabric doctor --fix`。

## 知识库(KB)
- **Discovery**:SessionStart hook 列 broad-scoped 条目(条目按 `semantic_scope` 分三层:`team` 团队通用 / `project:<id>` 本项目专属(仅在绑定该项目的仓库浮现)/ `personal` 个人 `KP-*`,三者引用方式相同);edit 文件时 PreToolUse hook 可能触发 narrow hint。
- **Usage**:走单步 `fab_recall(paths=[...])` 一次拿回相关 KB 的描述 + 读取路径;需要某条正文时对其 `entries[].read_path` 做原生 Read 取回(不再走 MCP 二次取正文)。
- **session_id**: 调用 `fab_recall` 时, 务必把当前 client session id 作为 `session_id` 参数传入(Claude Code 的 session id 在 stdin payload 中, Codex 的对应 identifier 同理)。这能让 `fabric doctor --archive-history` 与 `fabric-hint.cjs` Stop hook 准确识别跨会话 debt 状态。
- **Skills (7)**:写流程 `fabric-archive` / `fabric-review` / `fabric-import`;store 流程 `fabric-store` / `fabric-sync` / `fabric-connect`;诊断 `fabric-audit`。
- **Language**:渲染按 `~/.fabric/fabric-global.json` 的 `language` 字段(machine-wide tone)。
- **Archive cadence nudge** (rc.36): 每完成一批 Edit(默认 ~20 次, 与 Stop hook 阈值 config `archive_edit_threshold` 一致)/ 显著 decision 后,在合适回合主动 propose 调 `fabric-archive` skill — archive 没建立频率会让 KB 慢速死掉。
- **Review backlog nudge** (rc.36): 需要判断 pending backlog 时走 `fab_review action="list"` 或 `fabric-review` 返回的 `pending_path`;不要 glob 项目本地 `.fabric/knowledge/pending`。当可见 pending 累积 >10 条时,在合适回合主动 propose 调 `fabric-review` skill 批量审,避免 draft 卡死。

## Self-archive policy (v2.2 C1: 精简说明书)

出现明确归档信号时, 于该 turn 末尾自主调用 `fabric-archive` skill(AI 自触发入口 E3):

- **触发** (二选一): ① **User-driven normative** — 用户说 `以后` / `always` / `never` / `下次` / `记一下`, 或在 ≥2 候选间权衡后锁定方向, 或拒了建议并给了理由(理由即知识); ② **Wrong-turn-and-revert** — 你试了 path X 反思后改走 path Y("否定+替代"两步结构, 非单纯探索失败)。
- **不触发**: 用户纯询问 / 简单 refactor·typo / 凭空"我学到了"的洞察。
- **防 loop**: 同 turn 最多自调 1 次; 同 session 同 outcome 不重复; skill 内 Phase 2.5 viability gate 兜底。
- **回执 (marker-free)**: 直接自调 `fabric-archive` skill 即可, 无需打印任何暗号字符串 —— skill 默认把 AI 自调识别为 E3(确定性 else 路由, 不再依赖 AI 输出精确字符串)。skill 落 pending 后返回 `pending_path`, 不该记就回 `undo`(我调 fab_review reject)。

## Cite policy (v2.2 C1: recall 自动记账, 零首行负担)

- **核心 (recall-first 自动记账)**: 改任何文件前先 `fab_recall(paths=[<被改文件>])`。系统按"本 session recall 命中的 path 与编辑目标重叠"自动把召回的 KB 记为该次 edit 的引用 —— **无需手写任何回复首行**(C1 删除首行 `KB:` contract 八股:先想后说,recall 才是引用发生的真实信号)。PreToolUse 检测不到相关 recall 时给一条软 nudge(nudge 非 gate,守 KT-DEC-0007)。
- **唯一要开口的时候 (dismissed / override)**: 你判断某召回 KB 不该应用时,说一句 `dismissed: <id> (<reason>)`;reason 枚举 `scope-mismatch | outdated | not-applicable | other:<text>`。需精确标注仍可用首行 `KB: <id> [applied|dismissed]`(解析器保留,向后兼容)。
- **`[applied]` 验证义务**: 引用任何 id(自动或手写)前必须先 fab_recall 实际抓回 KB(按需对正文路径做原生 Read),防止编造 id。验证不通过 = 不能 cite。
- **稽核与完整规约**: `fabric audit cite` 输出覆盖率(不阻断工作,只记录);contract operator / store 前缀 / skip·dismissed 词典 / 类型路由 / 裁决阶梯等完整规约权威详参 `fabric-review` skill 的 `ref/cite-contract.md` —— bootstrap 只留可执行 core。
