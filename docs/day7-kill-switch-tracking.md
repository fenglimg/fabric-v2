# Day 7 Kill Switch 追踪

Day 7 验证的 canonical tracking sheet。

成功阈值：

| Kill Switch | Metric | Success Threshold | Failure Response |
|---|---|---|---|
| KS-1 | 30 次尝试中 `fab_get_rules` call rate | `>=60%` | 增加 `fab_write_file` hard gate、强化 `MANDATORY` tool descriptions、回顾 breathing prompt |
| KS-2 | p95 `fab_get_rules` stdio latency | `<2000ms` | 评估 HTTP transport 与 keepalive |
| KS-3 | Codex MCP liveness | Codex `tools/list` 显示全部 3 个 Fabric tools | Codex 路径降级为原生读取 `AGENTS.md` |

## KS-1：Tool-Call Adoption

每次尝试的任务：

```text
Add a Timer.ts component to this Cocos Creator stub.
```

成功计算：

```text
call_rate = attempts_with_fab_get_rules / 30
```

| Client | Attempt | Task Given | 是否调用 `fab_get_rules`？(Y/N) | Time-to-first-tool-call | Notes |
|---|---:|---|---|---|---|
| Claude Code | 1 | Add a Timer.ts component |  |  |  |
| Claude Code | 2 | Add a Timer.ts component |  |  |  |
| Claude Code | 3 | Add a Timer.ts component |  |  |  |
| Claude Code | 4 | Add a Timer.ts component |  |  |  |
| Claude Code | 5 | Add a Timer.ts component |  |  |  |
| Cursor | 1 | Add a Timer.ts component |  |  |  |
| Cursor | 2 | Add a Timer.ts component |  |  |  |
| Cursor | 3 | Add a Timer.ts component |  |  |  |
| Cursor | 4 | Add a Timer.ts component |  |  |  |
| Cursor | 5 | Add a Timer.ts component |  |  |  |
| Windsurf | 1 | Add a Timer.ts component |  |  |  |
| Windsurf | 2 | Add a Timer.ts component |  |  |  |
| Windsurf | 3 | Add a Timer.ts component |  |  |  |
| Windsurf | 4 | Add a Timer.ts component |  |  |  |
| Windsurf | 5 | Add a Timer.ts component |  |  |  |
| Roo Code | 1 | Add a Timer.ts component |  |  |  |
| Roo Code | 2 | Add a Timer.ts component |  |  |  |
| Roo Code | 3 | Add a Timer.ts component |  |  |  |
| Roo Code | 4 | Add a Timer.ts component |  |  |  |
| Roo Code | 5 | Add a Timer.ts component |  |  |  |
| Gemini CLI | 1 | Add a Timer.ts component |  |  |  |
| Gemini CLI | 2 | Add a Timer.ts component |  |  |  |
| Gemini CLI | 3 | Add a Timer.ts component |  |  |  |
| Gemini CLI | 4 | Add a Timer.ts component |  |  |  |
| Gemini CLI | 5 | Add a Timer.ts component |  |  |  |
| Codex CLI | 1 | Add a Timer.ts component |  |  |  |
| Codex CLI | 2 | Add a Timer.ts component |  |  |  |
| Codex CLI | 3 | Add a Timer.ts component |  |  |  |
| Codex CLI | 4 | Add a Timer.ts component |  |  |  |
| Codex CLI | 5 | Add a Timer.ts component |  |  |  |

KS-1 结果：

| Total Attempts | Calls Observed | Call Rate | Threshold | Pass/Fail | Notes |
|---:|---:|---:|---:|---|---|
| 30 |  |  | 60% |  |  |

## KS-2：Stdio Latency

记录每次观察到的 `fab_get_rules` 调用。若 client 未调用该 tool，latency 留空并在 KS-1 记录未命中。

| Client | Attempt | `fab_get_rules` Start Time | End Time | Latency (ms) | Notes |
|---|---:|---|---|---:|---|
| Claude Code | 1 |  |  |  |  |
| Claude Code | 2 |  |  |  |  |
| Claude Code | 3 |  |  |  |  |
| Claude Code | 4 |  |  |  |  |
| Claude Code | 5 |  |  |  |  |
| Cursor | 1 |  |  |  |  |
| Cursor | 2 |  |  |  |  |
| Cursor | 3 |  |  |  |  |
| Cursor | 4 |  |  |  |  |
| Cursor | 5 |  |  |  |  |
| Windsurf | 1 |  |  |  |  |
| Windsurf | 2 |  |  |  |  |
| Windsurf | 3 |  |  |  |  |
| Windsurf | 4 |  |  |  |  |
| Windsurf | 5 |  |  |  |  |
| Roo Code | 1 |  |  |  |  |
| Roo Code | 2 |  |  |  |  |
| Roo Code | 3 |  |  |  |  |
| Roo Code | 4 |  |  |  |  |
| Roo Code | 5 |  |  |  |  |
| Gemini CLI | 1 |  |  |  |  |
| Gemini CLI | 2 |  |  |  |  |
| Gemini CLI | 3 |  |  |  |  |
| Gemini CLI | 4 |  |  |  |  |
| Gemini CLI | 5 |  |  |  |  |
| Codex CLI | 1 |  |  |  |  |
| Codex CLI | 2 |  |  |  |  |
| Codex CLI | 3 |  |  |  |  |
| Codex CLI | 4 |  |  |  |  |
| Codex CLI | 5 |  |  |  |  |

KS-2 结果：

| Samples Included | p95 Latency (ms) | Threshold | Pass/Fail | Notes |
|---:|---:|---:|---|---|
|  |  | 2000 |  |  |

## KS-3：Codex MCP Liveness

Codex 必须列出全部三种 Fabric tools。

| Check | Expected | Observed | Pass/Fail | Notes |
|---|---|---|---|---|
| Codex `tools/list` succeeds | Yes |  |  |  |
| `fab_get_rules` present | Yes |  |  |  |
| `fab_append_intent` present | Yes |  |  |  |
| `fab_update_registry` present | Yes |  |  |  |

KS-3 结果：

| Codex Tools Listed | Required Tools Present | Pass/Fail | Notes |
|---|---|---|---|
|  | `fab_get_rules`, `fab_append_intent`, `fab_update_registry` |  |  |

## Day 7 最终结论

| Criterion | Pass/Fail | Evidence Link 或 Notes |
|---|---|---|
| Inner-track stub 已初始化并完成 scan |  |  |
| KS-1 call rate `>=60%` |  |  |
| KS-2 p95 latency `<2000ms` |  |  |
| KS-3 Codex tools/list 通过 |  |  |
| Outer-track scan 检测到真实 Cocos 项目 |  |  |
| Outer-track scan 在 `<10s` 内完成 |  |  |
| Private config 已保留 |  |  |
| Hook 行为非破坏性 |  |  |
