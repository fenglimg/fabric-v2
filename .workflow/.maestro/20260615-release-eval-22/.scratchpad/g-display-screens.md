# G-DISPLAY 展示画面采集 (本次 run: 2026-06-15T09:05:35.645Z)
> 真实渲染输出, 非合成。供报告③具体画面区 + B 冷评。

## ① SessionStart 注入 (knowledge-hint-broad banner)
```
(silent — cooldown/no payload)```

## ② doctor (健康总览)
```
[warn] fabric doctor /Users/wepie/Desktop/personal-projects/pcf-release-eval
TL;DR (top 1 of 1, severity order: fixable→manual→warn):
  [warn] events_jsonl_health_degraded: .fabric/metrics.jsonl 已 24 分钟未更新；server-side 60s flush 可能 stalled。
    → 运行 `fabric doctor --fix` —— 它会触发 rotation 并 flush metrics.jsonl(rc.2 F16: 无需重启 server 即可清出 idle 期未刷的 metric counter)。若告警仍持续, 再重启 MCP server 让 startMetricsFlush + startRotationTick 重新调度。若 metric_leak 命中, 检查最近代码改动是否绕过 bumpCounter API 直接 appendEventLedgerEvent 写了 4 个 metric-managed event_type 之一。
[warn] Events ledger 健康 (rc.37 Plan B 5 hard gate): .fabric/metrics.jsonl 已 24 分钟未更新；server-side 60s flush 可能 stalled。

警告：
- events_jsonl_health_degraded: .fabric/metrics.jsonl 已 24 分钟未更新；server-side 60s flush 可能 stalled。
  → 运行 `fabric doctor --fix` —— 它会触发 rotation 并 flush metrics.jsonl(rc.2 F16: 无需重启 server 即可清出 idle 期未刷的 metric counter)。若告警仍持续, 再重启 MCP server 让 startMetricsFlush + startRotationTick 重新调度。若 metric_leak 命中, 检查最近代码改动是否绕过 bumpCounter API 直接 appendEventLedgerEvent 写了 4 个 metric-managed event_type 之一。

MCP payload 阈值：
- warn=16 KB, hard=64 KB (来源: default)
```

## ③ doctor --cite-coverage (cite 合规渲染)
```
Cite 覆盖率:
起始 2026-06-15T08:58:27.396Z (政策激活时间 2026-06-15T08:58:27.396Z)

  Edit 触达数: 4
  合格 cite: 0
  applied 但未验证: 0
  应查没查: 0
  总回合数: 0
  cite 合规率 (含 KB:none[reason]): N/A (无应 cite 回合)
  recall 覆盖率 (改前有相关 fab_recall 的 edit 占比): 0.0% (0/4)
  曝光且路径变更 (弱辅助信号 — 不计入真遵循度): 0
  mutation 观测数 (PostToolUse file_mutated — 权威信号, 不计入真遵循度): 4
  mutation 归因池 (经 source_event_id 的 low-confidence 归因): 0 / 4 (attributed / unattributed_workspace_dirty)
  已闭合 session 数 (SessionEnd marker — funnel 边界): 0

### 应用契约校验
  status: 正常
  since: 2026-06-15T08:58:27.398Z
  layer filter: all
  decisions 引用: 0
  pitfalls 引用: 0
  已附契约: 0
  缺契约: 0
```

## ④ SessionStart broad banner (本会话真实注入, verbatim)
```
[fabric] Session start — 8 broad-scoped knowledge entries available:
  [decisions] (proven):
    - team:KT-DEC-0001 · Boundary B: data + lifecycle + async-review primitive
    - team:KT-DEC-0003 · Dual-root layout: ~/.fabric + <repo>/.fabric
  [decisions] (draft):
    - team:KT-DEC-0019 · 用户察觉 fab_recall 单次调用返回体过大...
  [guidelines] (draft):
    - team:KT-GLD-0005 · 用户在 grill 中掀翻执行者 frame...
  revision_hash: sha256:f27f54...; Load full: fab_recall(paths)
[fabric] read-set stores: team (write), personal
```

## 渲染正确性硬闸判定
- snapshot 漂移闸: cli-surface/client-configs/mcp-config-merge/i18n/tool-contracts/doctor-i18n 全在 G-MACHINE 2403 测套绿 = 零漂移
- 明显错渲染: 无原始 i18n key 泄漏(zh-CN 正常渲染)/无乱码/无未闭合标记/严重度排序正确/可执行 remediation 完整 = PASS
- events_jsonl_health_degraded warn = 真实但良性(eval 期无活 MCP server flush metrics, 非 bug)
