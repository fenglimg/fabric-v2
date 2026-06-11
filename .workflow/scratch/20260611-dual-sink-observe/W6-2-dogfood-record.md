# W6-2 Dogfood 实测记录 — CC SessionStart 人出口 systemMessage 可见

> Goal A dual-sink 终止 gate。证据:CC SessionStart 触发后顶层 `systemMessage`(人出口)可见。

## 复现步骤(可重跑)

```sh
WT=/Users/wepie/Desktop/personal-projects/pcf-dual-sink
# 1) 构建 worktree CLI(plan-context-hint 才会带 W3-1 census + always_bodies)
pnpm --filter @fenglimg/fabric-shared --filter @fenglimg/fabric-server --filter @fenglimg/fabric-cli build
# 2) shim 让 hook 的 `fabric` 解析到 worktree 构建(全局 fabric 指向 main repo,无 dual-sink)
printf '#!/bin/sh\nexec node "%s/packages/cli/dist/index.js" "$@"\n' "$WT" > /tmp/fab-dogfood-bin/fabric
chmod +x /tmp/fab-dogfood-bin/fabric
# 3) 以 CC 身份(CLAUDE_PROJECT_DIR → detectClient=cc)实跑 SessionStart hook 源真值 template
PATH="/tmp/fab-dogfood-bin:$PATH" CLAUDE_PROJECT_DIR="$WT" \
  node packages/cli/templates/hooks/knowledge-hint-broad.cjs
```

## 实测 stdout(CC dual-sink 信封)

top-level keys: `["systemMessage", "hookSpecificOutput"]`

**人出口 `systemMessage`**(CC 直接渲染到用户 transcript,非被 exit-0 抑制的 stderr):
```
▸ [fabric] SessionStart (36 KB)
  ─ always-loaded(AI 也收到正文)─
   guideline 5
  ─ on-demand(改文件时 fab_recall)─
   decision 22 · pitfall 9
  [team] 35 · [personal] 1
[fabric] read-set stores: team (write), personal
下一步: 调 fab_recall(paths) 拿 KB 相关条目;或调 fab_plan_context 先看候选描述(candidates)。
```

**AI 出口 `hookSpecificOutput.additionalContext`**:
```
[fabric:SessionStart] store
ALWAYS-ACTIVE RULES (无需再 recall):
  [guideline] team:KT-GLD-0001
# Code style guidelines
...
ON-DEMAND (改文件时 fab_recall(paths)): decisions 22 · pitfalls 9
```

## 断言(全过)
- `typeof systemMessage === "string"` ✓
- systemMessage 含 census headline `▸ [fabric] SessionStart (N KB)` ✓
- 人出口含 always-loaded 分组 ✓ / on-demand 分组 ✓
- AI additionalContext 含 ALWAYS-ACTIVE 正文 ✓
- hookSpecificOutput.hookEventName === "SessionStart" ✓

## 关键说明
- 跑的是**源真值 template**(`packages/cli/templates/hooks/`),非 worktree 自身陈旧的 `.claude/hooks/` 安装副本(W3-2 改 template 后本 repo 未重跑 fabric install,安装副本缺 renderHumanCensus/emitDualSink/lib/nudge-policy.cjs)。
- template→安装副本的 byte-identical 复制由 `install-skills-and-hooks.test.ts`(21 passed,含 byte-identity 断言)保证;故 template 正确 ⟹ 真实 fabric install 后人出口照样 systemMessage 落地。
- 全局 `fabric` symlink 指向 main repo(`pcf/packages/cli/dist`),不含 W3-1 census/always_bodies → 必须用 worktree 构建 + shim 才能验真 dual-sink 数据层。
- nudge_mode/observe 在 worktree config 未设(undefined)→ resolveHumanSink 默认 `emitHuman:true` → 人 banner 默认可见(符合"知识对人可见"初衷;C4 不变量=nudge_mode 只调人出口由 W1-2 单测守)。
