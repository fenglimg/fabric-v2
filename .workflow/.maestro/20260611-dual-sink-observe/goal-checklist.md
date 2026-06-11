# Goal: Fabric 知识流向观测层 (dual sink) — Goal A

> **mode①(计划驱动)** · status.json 为真源,本文件是投影视图。
> spec 锚: `rev4.4-final.md`(§6 Goal A) · 基线 `FINAL-complete-spec.md`
> worktree: `pcf-dual-sink` @ `feat/dual-sink-observe`

## 一句话目标
把"知识每一步人眼可见"落地 —— 当前 stderr 人出口在 CC 上被 exit-0 抑制是死的,`systemMessage` 源码树零出现。dual sink 是净新增的观测支柱。**数据路径已接线 ≠ dual sink 已落地**(防 false-green)。

## 边界契约
**In scope (Goal A)**: dual sink 三分支 / banner 重构 / 注入层 project filter / config 预设 / PreToolUse gate / Stop value-gated软nudge / Codex matcher apply_patch。
**Out of scope (归 Goal B)**: cite-policy-evict 退役 · fabric-hint contract DSL 瘦身 · selectable 死字段 · L0L1L2+co-location cutover · relevance_scope↔activation 收敛。**不动 store 读写底层(已接线)**。
**约束**: Hook⊥MCP 边界(脚本不做语义匹配,always 正文随 banner 例外) · 改 shared schema 必 rebuild dist · never-throw 契约 · 源真值在 templates/hooks/ · 每 wave 收口 commit 回填 sha · tsc --noEmit 前置闸。

## 终止判据(全 done + W6 dogfood gate)
| 判据 | wave | 状态 |
|---|---|---|
| C1 emitContext 三分支 | W2-1 | ✅ |
| C2 banner 重构(人普查/AI always正文+计数) | W3-1, W3-2 | ✅ |
| C3 注入层 filterByActiveProject 镜像 | W3-1 | ✅ |
| C4 config 预设 nudge_mode+observe.*(不变量:只调人出口) | W1-1, W1-2 | ✅ |
| C5 PreToolUse命中gate + Stop软nudge value-gated | W4-1, W4-2 | ✅ |
| C6 Codex matcher 加 apply_patch | W5-1 | ✅ |
| C7 全测试绿+tsc + dogfood CC banner systemMessage | W6-1, W6-2 | ✅ |

**✅ 全 7 判据达成(2026-06-11)** — task_decomposition 全 done + W6-2 dogfood gate 过(CC SessionStart 顶层 systemMessage 人出口可见)。

## Waves(依赖序)
- **W1 config 基座** (W1-1 schema+rebuild → W1-2 nudge-policy resolver+不变量) — 先做,后续 hook 都读它
- **W2 dual sink core** (W2-1 emitContext 三分支) — 独立,所有 hook 出口经它
- **W3 SessionStart banner** (W3-1 plan-context-hint always正文+project filter+rebuild → W3-2 banner 两 sink 渲染) — 依赖 W1+W2
- **W4 PreToolUse+Stop** (W4-1 narrow 命中gate/未recall AI-only;W4-2 fabric-hint Stop value-gated软nudge) — 依赖 W2
- **W5 Codex matcher** (W5-1 codex-hooks.json apply_patch + install 同步)
- **W6 收口** (W6-1 tsc+全测试绿 → W6-2 dogfood CC banner systemMessage 实测)

## 关键代码锚(已核验)
- `packages/cli/templates/hooks/lib/client-adapter.cjs` — emitContext(L81),现二选一,systemMessage 零出现
- `packages/cli/templates/hooks/knowledge-hint-broad.cjs` — SessionStart banner,top_k=8 静态(L191/L833)
- `packages/cli/templates/hooks/knowledge-hint-narrow.cjs` — PreToolUse
- `packages/cli/templates/hooks/fabric-hint.cjs` — Stop archive nudge
- `packages/cli/src/commands/plan-context-hint.ts` — payload 仅 summary 无 body(L196)
- `packages/server/src/services/cross-store-recall.ts` — `filterByActiveProject`(待镜像)
- `packages/shared/src/schemas/fabric-config.ts` — 旋钮汤(L71-490),加 nudge_mode+observe.*
- `packages/cli/templates/hooks/configs/codex-hooks.json` — matcher Edit|Write|MultiEdit(加 apply_patch)

## Resume
推进下一步: `/goal-mode continue`(推进一个 wave/task → 跑 verification → 原子更新 status.json → 重检终止 + drift gate)。
显式收尾: `/goal-mode close`。
