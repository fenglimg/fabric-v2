# MCP-First Fabric v2.0 — 加固版最终设计

> 基于 Phase 2 研究 + Phase 3 两轮挑战（Gemini 3.1 Pro 魔鬼代言人 + Claude 工程落地）
> 状态：**Conditional-Go → Go** (加固调整全部纳入)
> 日期：2026-04-18

---

## 1. TL;DR（一句话）

**Fabric 是一个以本地 MCP Server 为主通道、以 6 个主流 AI 客户端（Claude Code / Cursor / Windsurf / Roo Code / Gemini CLI / Codex CLI）为目标的项目文档协议：用户写纯 Markdown AGENTS.md 树，AI 通过 MCP tool 按需查询，git pre-commit 兜底一切强制性约束。**

> 明确放弃 GitHub Copilot。Copilot 用户应继续使用 `.github/copilot-instructions.md`，Fabric 不为其编译。

---

## 2. 最终架构（5 层）

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 0 — 规范层（入 git，人类维护）                          │
│   AGENTS.md（L0 根, <300 行, 含 <!-- fab:index -->）           │
│   L1/**/AGENTS.md（领域层）                                    │
│   L2/**/AGENTS.md（组件层）                                    │
│   → 纯 Markdown，人类阅读优先                                  │
├──────────────────────────────────────────────────────────────┤
│ Layer 1 — 元数据层（入 git，机器维护）⭐ 新                   │
│   .fabric/agents.meta.json                                    │
│   { "L0": {...}, "L1": {...}, "L2": {...}, "@HUMAN": [...] }  │
│   → AI 不直接编辑；通过 fab_update_registry 工具修改          │
│   → 解决 Gemini 指出的"AI 重构会误删 HTML 注释"风险           │
├──────────────────────────────────────────────────────────────┤
│ Layer 2 — 意图层（入 git，append-only）                       │
│   .intent-ledger.jsonl                                        │
│   每次 commit 一条；git pre-commit 从 staged diff 反推         │
├──────────────────────────────────────────────────────────────┤
│ Layer 3 — 分发层（通过 MCP，非文件）                           │
│   fabric-context-server (stdio, 单二进制)                     │
│   tools:                                                       │
│     • fab_get_rules(path, revision_hash?) ⭐ 带 hash 游标    │
│     • fab_append_intent(entry)                                │
│     • fab_update_registry(op) ⭐ 更新元数据专用通道           │
│   → 6 客户端统一配置                                           │
├──────────────────────────────────────────────────────────────┤
│ Layer 4 — 防御层（多重）                                       │
│   A. MCP tool 描述带强制提示 (防惰性坍塌)                      │
│   B. 各客户端首屏注入 5 行"呼吸式引导" (防遗忘)                │
│   C. git pre-commit hook：                                     │
│      • 补写 ledger                                             │
│      • 校验 @HUMAN 段未被篡改（AST/精确字符串匹配）            │
│      • 禁止直接改 agents.meta.json（必须走 fab_update_registry）│
│   D. 可选 OS 只读（@HUMAN 宪法级，默认关闭）                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Phase 3 挑战 → 加固决策表

| 风险 | 分数 | Gemini 建议 | Claude 工程 | **v2.0 最终决策** |
|------|------|-------------|-------------|-------------------|
| **惰性坍塌**（AI 不调工具） | 25 | Fear-driven tool desc + pre-flight interceptor | stdio MCP (低延迟) | **① Tool desc 带 "MANDATORY" 标语**<br>**② git pre-commit 校验本次 commit 是否对应 >=1 条 intent ledger 记录（缺则警告）** |
| **Boundary erosion**（AI 破坏 @HUMAN 标记） | 20 | AST hash + shift-left via fab_write_file | - | **① 引入 `.fabric/human-lock.json` 存人工段的精确字符串+位置**<br>**② pre-commit diff 计算：若 human-lock 中任一段的 hash 变化 → 阻断** |
| **Phantom cache**（多端状态撕裂） | 16 | Stateless + revision_hash | - | **fab_get_rules 返回值带 `revision_hash`；client 每次请求需传上次收到的 hash，不匹配则 server 返回 `stale` 标记** |
| **Forgetting**（长会话遗忘 MCP） | 12 | Breathing prompt + self-attestation | - | **5 行首屏引导词** (模板见下)；不做 self-attestation（侵入性太强） |
| **Metadata destruction** | 9 | Hard isolation to JSON | - | **采纳**。`AGENTS.md` 内**只**保留 `<!-- fab:index -->` 作为人类可读的一行列表；机器消费的结构化元数据**全部**入 `.fabric/agents.meta.json` |

---

## 4. 关键设计细节

### 4.1 元数据分层：HTML 注释仅作人类 TOC，JSON 作机器源

**AGENTS.md (根) 里只写这种最简注释**：
```markdown
# My Project — L0 AGENTS.md

<!-- fab:index -->
- L1/features/auth  —— 鉴权业务规则
- L1/features/game  —— 狼人杀核心引擎
- L2/components/ui-dialog  —— 通用对话框组件
<!-- /fab:index -->

## L0 宪法（AI 必读）
- 所有代码必须 TypeScript
- 禁用 any
- ...
```

**`.fabric/agents.meta.json` 存机器消费**：
```json
{
  "revision": "sha256:abcdef...",
  "nodes": {
    "L1/features/auth": {
      "file": "src/features/auth/AGENTS.md",
      "scope_glob": "src/features/auth/**",
      "deps": ["L0"],
      "priority": "high",
      "hash": "sha256:..."
    }
  },
  "human_locked": [
    { "file": "AGENTS.md", "start_line": 45, "end_line": 62, "hash": "sha256:..." }
  ]
}
```

**修改时**：
- 人类改 AGENTS.md → pre-commit hook 调 `fab sync-meta` 自动刷新 `.fabric/agents.meta.json`
- AI 想加 L1 节点 → **必须**调 `fab_update_registry({op: "add-node", ...})`，AI 不得直接改 JSON

### 4.2 5 行呼吸式首屏引导词（各客户端统一）

每个客户端的"首屏规则文件"（`CLAUDE.md` / `.cursor/rules/fabric-bootstrap.mdc` / `.windsurf/rules/fabric.md` / `.roo/rules/fabric.md` / `GEMINI.md` / codex 对应的 AGENTS.md 头部）都只写这 5 行：

```markdown
# Fabric Bootstrap
- 本项目使用 Fabric Protocol 管理规则。
- **任何文件修改前**，必须调 MCP tool `fab_get_rules(path=<被改文件>)` 获取规则。
- 新建 L1/L2 节点时，必须调 `fab_update_registry`，**严禁**直接编辑 `.fabric/agents.meta.json`。
- 涉及 `@HUMAN` 段（`.fabric/human-lock.json` 中列出）时，必须停下来请示人类。
- 每次完整任务结束，调 `fab_append_intent` 写一条意图记录。
```

Claude Code 的 `CLAUDE.md` 再加一行 `@AGENTS.md` 导入完整规范；其他客户端则用它们原生的导入语法。

### 4.3 fab_get_rules(path, revision_hash?) 的响应协议

```typescript
// response
{
  revision_hash: "sha256:...",    // 服务端当前 meta 版本
  stale: false,                    // 若 client 传的 hash 与 server 不同 → true
  rules: {
    L0: "<L0 AGENTS.md content>",
    L1: [ { path: "...", content: "..." } ],
    L2: [ { path: "...", content: "..." } ],
    human_locked_nearby: [ { file: "...", excerpt: "..." } ]
  }
}
```

AI 在后续任务里**应该**（引导词要求）再次调用并传上次 hash；若 server 返回 `stale: true`，AI 应丢弃缓存重新使用新 rules。

### 4.4 Pre-commit Pipeline（跨端唯一强制层）

```bash
#!/bin/sh
# .husky/pre-commit

# 1. 刷新元数据（人类改了 AGENTS.md 树的情况）
npx fab sync-meta --check-only

# 2. 校验 @HUMAN 段完整性（human-lock hash 对照）
npx fab human-lint || exit 1

# 3. 从 staged diff 反推追加 intent-ledger
npx fab ledger append --staged

# 4. 禁止直接修改 .fabric/agents.meta.json
if git diff --cached --name-only | grep -q "^\.fabric/agents\.meta\.json$"; then
  if ! [ "$FAB_ALLOW_META_EDIT" = "1" ]; then
    echo "❌ .fabric/agents.meta.json 不可手工修改，请通过 fab_update_registry 或 fab sync-meta"
    exit 1
  fi
fi
```

目标：300ms 以内完成。

### 4.5 接入存量项目（用户痛点 A）

```bash
# 在 werewolf-minigame 根目录执行
npx fab init

# fab init 行为：
# 1. 扫描现有 README.md / CONTRIBUTING.md / .github/*
# 2. 提取"技术章节"（setup/arch/style）提示用户拆到 L1
# 3. 生成 L0 AGENTS.md 骨架：
#    - @ref CONTRIBUTING.md（不重写，引用）
#    - <!-- fab:index --> 空段
#    - 基本 L0 宪法模板
# 4. 生成 .fabric/agents.meta.json（仅 L0）
# 5. 生成 .husky/pre-commit
# 6. 打印：下一步建议（e.g. "src/features/auth 看起来是一个 L1 候选"）
```

**关键：不改动任何已有文件**（README/CONTRIBUTING 保持人类风格），只**新增** AGENTS.md 树。

### 4.6 人机文档关系（用户痛点 B）—— 引用而非合并

```markdown
# AGENTS.md (L0)
## 项目简介
<!-- fab:ref path="README.md" section="Overview" -->
> 详见 [README.md](./README.md#overview)

## 贡献流程
<!-- fab:ref path="CONTRIBUTING.md" -->
> AI 必须遵守 [CONTRIBUTING.md](./CONTRIBUTING.md) 中的 PR 流程。

## AI 特有约束 (不在人类文档里)
- 本节仅 AI 读。
- 禁止...
```

**三条原则**：
1. 人类文档（README/CONTRIBUTING）是**事实源**，AGENTS.md 通过 `fab:ref` 引用
2. AGENTS.md 只写**AI 专有约束**（人类文档里没有的）
3. 同时适用于人和 AI 的规则 → 写在人类文档，AGENTS.md 用 `fab:ref` 指过去

### 4.7 人 AI 双可读（用户痛点 C）—— 实际视觉

人类打开 `AGENTS.md` 看到：
```markdown
# Werewolf Minigame — AGENTS.md

<!-- fab:index -->
- L1/features/game        —— 游戏主循环
- L1/features/network     —— 多端同步
- L2/components/ui-card   —— 角色卡片组件
<!-- /fab:index -->

## 项目技术栈
- TypeScript + React 19
- Vite + Vitest
- ws 协议 WebSocket

## L0 AI 必读约束
- 禁止 any
- 禁止 .then() 链（用 async/await）
- ...

## @HUMAN（人类决策区，AI 只读）
- 新增外部依赖需 PR review
- 数据库 migration 脚本需人工确认
```

**视觉成本**：4 行 HTML 注释（`<!-- fab:index -->` 边界 + 2 个其他锚点），人类基本看不到（GitHub/VS Code 预览都会隐藏注释）。对 AI：编译器明确抓取。

---

## 5. 一周 MVP 清单

| Day | 交付 | 验收 |
|-----|-----|------|
| **1** | fabric-context-server 骨架 + 3 个 MCP tool + stdio 启动 | `fab_get_rules({path:"src"})` 返回 L0+L1 合并文本 |
| **2** | 6 客户端 MCP 配置文件模板 + 实测连通（调 tools/list） | 6 个客户端都能看到 3 个 tool |
| **3** | fab CLI：init / sync-meta / human-lint / ledger-append | 在 werewolf-minigame 跑 `fab init` 成功，不破坏已有文件 |
| **4** | .husky/pre-commit 集成 + @HUMAN lock 校验 | 故意改 @HUMAN 段 → commit 被阻断 |
| **5** | revision_hash 机制 + stale 响应 | 两个终端打开同项目，A 改 L1 → B 的下次查询返回 stale |
| **6** | 5 行 bootstrap 引导词 × 6 客户端 | 新会话里提问"帮我加一个新组件"，AI 确实会去调 fab_get_rules |
| **7** | 端到端验收：werewolf-minigame 挂载 + 6 客户端 demo 视频 | 每客户端各做 1 个小任务，都能看到规则被遵守 |

---

## 6. Kill Switch 监测（前 3 天必须跑）

| KS | 触发信号 | 检测方法 | 应对 |
|----|---------|---------|------|
| **KS-1** AI 在大多数客户端下不主动调 fab_get_rules | 30 次测试任务中 <60% 调了工具 | Day 6 端到端测试统计 | 在 fab_write_file（自研 MCP 写入工具）加 hard gate；改动客户端工作流 |
| **KS-2** MCP stdio 在某客户端延迟 >2s | fab_get_rules 响应时间 p95 | Day 2 实测 | 换 HTTP transport + keepalive |
| **KS-3** Codex CLI 的 MCP 实际不可用 | tools/list 调用失败 | Day 2 实测 | 降级为 AGENTS.md 直读（Codex 支持 AGENTS.md 原生） |

---

## 7. Verdict

- 原始 Fabric Protocol → **must_fix × 4**
- Fabric Lite v1.1（多端编译产物） → **go，但工程量大**
- **Fabric v2.0 MCP-First Fortified → go（推荐）**
  - 跨 6 端统一 MCP 通道
  - 元数据 JSON 硬隔离（抗 AI 破坏）
  - 5 行呼吸引导 + pre-commit hard gate（抗惰性）
  - revision_hash 游标（抗幻影缓存）
  - git hook 跨端强制（不依赖客户端能力差异）

**明确放弃**：GitHub Copilot（建议 Copilot 用户走独立 `.github/copilot-instructions.md`，非本协议目标）
