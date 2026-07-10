# TASK-23: Simulated cursor / codex 跨客户端 audit

**Date**: 2026-05-26
**Mode**: Claude fresh-eyes 双 persona simulated walkthrough (没有真实 install,通过读 install.ts 推演)
**Scope**: 30min per persona,识别 cursor + codex 端 friction 与 P0 候选

---

## Persona A — Cursor 用户首次接入

**Background**: 已习惯 Cursor `.cursor/rules/` MDC 机制,看到 GitHub README 决定试用 Fabric。

### Walkthrough

1. `npm install -g @fenglimg/fabric-cli@latest` — OK
2. `cd ~/projects/my-app && fabric install --client=cursor`
3. 期望: 看到 `.cursor/rules/fabric-bootstrap.mdc` 被创建;managed block 嵌入 BOOTSTRAP_CANONICAL
4. 实际(预期): install pipeline 走 cursor 分支,写 `.cursor/rules/fabric-bootstrap.mdc`;hook 数据 落 `.cursor/.fabric/events.jsonl`(估测)

### Friction 候选 (P0/P1)

- **F1 (P0)** Cursor 用户**没有 SKILL 入口**: cursor 不支持 `.claude/skills/` 模式。fabric-archive / fabric-review / fabric-import 三个 skill 在 cursor 端**整体缺位**。用户读 AGENTS.md 看到 "Write flows: fabric-archive / fabric-review / fabric-import 三个 Skills" → 找不到执行入口 → 整个 KB 写入流断流。
- **F2 (P0)** **Cite policy 在 cursor 端无 PostToolUse hook**: BOOTSTRAP_CANONICAL "Cite policy" 段要求每次 edit 前写 `KB: <id>` 行,但 cursor 没有自动执行的 hook → 全靠 LLM 自觉,在 Cursor 端遵循率必然为 0(类比 werewolf cc 端 0/15765)。
- **F3 (P1)** `fabric doctor` 在 cursor workspace 跑结果: cursor `.cursor/rules/` 是否会被 doctor 35 checks 正确读取? 当前 doctor 主要扫 `.claude/` 路径,cursor 路径可能 silent miss。
- **F4 (P1)** Self-archive policy 段的 "marker 行 + Phase 0.4 trigger gate" 全是 Claude Code 内部机制,Cursor 用户读到这段会困惑且无法执行。

### 建议 rc.36 / rc.37 修

- rc.36 候选: BOOTSTRAP_CANONICAL 加 "Cursor users: skills + cite-policy enforcement 暂不可用,可手动调 fabric-archive 等价行为" 提示。
- rc.37 必修: 重设计 cursor-end UX,可能要补 cursor 专属 hook(基于 Cursor 的 onChange API)。
- rc.37 candidate: doctor 加 `client_capability_mismatch` lint,在 cursor workspace 上 warn"hook/skill 路径缺失"。

---

## Persona B — Codex CLI 用户首次接入

**Background**: 用 OpenAI codex CLI ($ codex) 作为主 AI 客户端,看 README 后试 Fabric。

### Walkthrough

1. `npm install -g @fenglimg/fabric-cli@latest`
2. `cd ~/projects/python-cli && fabric install --client=codex`
3. 期望: 看到 `AGENTS.md` (Codex 用 AGENTS.md 不用 CLAUDE.md) managed block 注入;hook 配置写到 `~/.codex/...`
4. 实际(从 templates/hooks/configs/codex-hooks.json + install.ts 推演): hook 配置注入 codex 自定义事件系统;`.codex/skills/<slug>/SKILL.md` 镜像 `.claude/skills/<slug>/`

### Friction 候选

- **F5 (P0)** **Hook 在 Codex 端的 trigger 路径未文档化**: `templates/hooks/configs/codex-hooks.json` 引用 Codex 的 hook spec,但 BOOTSTRAP_CANONICAL / docs 没说明 Codex hook 触发时机(Codex 用户从 README 走过来不知道是否在 edit 时真的会 fire)。
- **F6 (P0)** **Cite hallucination 风险显著**: rc.36 EVAL 已实证 codex 端 10/10 `[recalled]` cite 全是 hallucination ID。`fab_get_knowledge_sections` MCP 调用前置约束在 codex 端**没有 PreToolUse 拦截器**(只有 stop hook),所以 AI 会编 ID。TASK-02 (cite hallucination warn) 就是为这个问题,但 codex 路径 stop-hook 时效太晚 — AI 已经写完 reply 才被 warn,无法 block。
- **F7 (P1)** **`fabric_language` 在 codex 端的 banner 渲染未实证**: Codex CLI 的 stdout 在中文环境下是否正确渲染 UTF-8 banner 未在 CI 验证。
- **F8 (P1)** **`fabric doctor` 退出码语义**: codex 用户通过 `$ codex` 启动后 cwd 是否会被正确传给 doctor? 如果 codex 用工作目录 vs 项目根目录有歧义,doctor 报 "not initialized" 假阴性。

### 建议 rc.36 / rc.37 修

- rc.36 已被 TASK-02 (cite hallucination warn) + TASK-27 (--archive-history integration + session_id lint) + TASK-31 (Codex CLI CI smoke) 部分覆盖。本 task 是这些 audit 的源头。
- rc.37 必修: 为 Codex 添加 PreToolUse 等价拦截器(若 Codex API 支持),或在 prompt-level 加更强约束。

---

## 跨 client 共性 friction

- **F9 (P0)** `fabric_language` resolver 在 cursor + codex 工作流没有 e2e 覆盖。当前只 cc 端有 i18n snapshot test。
- **F10 (P1)** SKILL.md 在 codex 端是 byte-mirror 但 cursor 端 zero — 这种 capability mismatch 没有任何 user-facing surface 告知。

---

## 结论

**rc.36 audit-only result**: 10 个 friction candidate (4 P0 / 6 P1),全为非阻断性 (个人用户单 client 不受影响)。**cursor + codex 端是名义支持但**实际**功能等价不到 1/3**。

**rc.37 必修 top 3**:
1. cursor 端 KB write-flow 补救 (F1)
2. codex 端 cite hallucination block-not-warn (F6)
3. doctor `client_capability_mismatch` lint 揭示问题 (F3 + F10)

**本次 audit 局限**: 没有真实 cursor / codex 客户端,完全 desk-walkthrough。rc.37 必须真跑一次 cursor + codex end-to-end (T7 cross-client real)。
