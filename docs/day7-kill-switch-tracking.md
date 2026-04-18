# Day 7 Kill Switch Tracking

This is the canonical tracking sheet for Day 7 validation.

Success thresholds:

| Kill Switch | Metric | Success Threshold | Failure Response |
|---|---|---|---|
| KS-1 | `fab_get_rules` call rate across 30 attempts | `>=60%` | Add `fab_write_file` hard gate, strengthen `MANDATORY` tool descriptions, revisit breathing prompt |
| KS-2 | p95 `fab_get_rules` stdio latency | `<2000ms` | Evaluate HTTP transport plus keepalive |
| KS-3 | Codex MCP liveness | Codex `tools/list` shows all 3 Fabric tools | Degrade Codex path to native `AGENTS.md` reading |

## KS-1: Tool-Call Adoption

Task for every attempt:

```text
Add a Timer.ts component to this Cocos Creator stub.
```

Success calculation:

```text
call_rate = attempts_with_fab_get_rules / 30
```

| Client | Attempt | Task Given | Called `fab_get_rules`? (Y/N) | Time-to-first-tool-call | Notes |
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

KS-1 result:

| Total Attempts | Calls Observed | Call Rate | Threshold | Pass/Fail | Notes |
|---:|---:|---:|---:|---|---|
| 30 |  |  | 60% |  |  |

## KS-2: Stdio Latency

Record every observed `fab_get_rules` call. If a client does not call the tool, leave latency blank and record the miss in KS-1.

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

KS-2 result:

| Samples Included | p95 Latency (ms) | Threshold | Pass/Fail | Notes |
|---:|---:|---:|---|---|
|  |  | 2000 |  |  |

## KS-3: Codex MCP Liveness

Codex must list all three Fabric tools.

| Check | Expected | Observed | Pass/Fail | Notes |
|---|---|---|---|---|
| Codex `tools/list` succeeds | Yes |  |  |  |
| `fab_get_rules` present | Yes |  |  |  |
| `fab_append_intent` present | Yes |  |  |  |
| `fab_update_registry` present | Yes |  |  |  |

KS-3 result:

| Codex Tools Listed | Required Tools Present | Pass/Fail | Notes |
|---|---|---|---|
|  | `fab_get_rules`, `fab_append_intent`, `fab_update_registry` |  |  |

## Final Day 7 Verdict

| Criterion | Pass/Fail | Evidence Link or Notes |
|---|---|---|
| Inner-track stub initialized and scanned |  |  |
| KS-1 call rate `>=60%` |  |  |
| KS-2 p95 latency `<2000ms` |  |  |
| KS-3 Codex tools/list passed |  |  |
| Outer-track scan detected real Cocos project |  |  |
| Outer-track scan completed `<10s` |  |  |
| Private configs preserved |  |  |
| Hook behavior non-destructive |  |  |
