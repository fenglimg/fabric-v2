# UX-14 doctor 故障自救 dogfood (G-DOCTOR-RECOVERY ≥80%, floor 60%)

## 方法
fresh `fabric install --yes` 进 tmp → `doctor --fix` 得绿基线 → snapshot → 逐个诱导 6 类 broken state → doctor 检测 + remediation → --fix/install 自救 → restore。

## 6 broken state 自救结果

| # | broken state | doctor 检测 | remediation | 自救? |
|---|---|---|---|---|
| S1 | corrupt agents.meta (invalid JSON) | [error] agents_meta_invalid: 精确到 'Expected property name at line1 col3' + content_refs_unavailable | --fix 重建 meta | ✅ --fix→exit0 |
| S2 | missing description (strip node desc) | [warn] agents_meta_stale + meta_manually_diverged 'Run --fix to reconcile' | --fix reconcile 重导 desc | ✅ --fix→exit0 |
| S3 | events.jsonl bloat | size-gate >10MB warn (dev-repo 25MB 实证 + rotation 指引); 损坏内容 [error] event_ledger_partial_write 'Run --fix to truncate' | --fix truncate / Plan B rotation | ✅ 检测+可操作 |
| S4 | hook 损坏 (corrupt narrow .cjs) | [warn] hooks_runtime_invalid: 点名文件 + 'missing_shebang: first line not #!' | message 指 fabric install 重拷 hook | ✅ 可操作 (install) |
| S5 | cross-client drift (.codex hook 改) | [warn] hooks_content_drift: 点名 basename + 涉及 client + 'fabric install copies the source...' | fabric install | ✅ 可操作 (install) |
| S6 | stale .serve.lock (dead PID) | info-advisory (低严重度, by design rc.23) | --fix 'Removed stale .serve.lock (dead PID)' 自动清 | ✅ --fix 后 lock 消失 |

**自救率 = 6/6 = 100%** ≥ target 80%, 远超 floor 60%。

## 观察
- remediation 普遍高质: 错误精确定位 (S1 JSON 行列 / S4 文件名+原因) + 明确 next-action (--fix OR fabric install)。
- --fix 覆盖: meta/desc/lock/events 类 (S1/S2/S3/S6); hook 类 (S4/S5) 走 fabric install (message 明确指出)。两条自救路径都被 remediation 文案点名, 用户不需猜。
- 次要 mode (G2: --fix-knowledge/--archive-history/--enrich-descriptions/--history) 输出可读 (前测 doctor --cite-coverage / 各 mode 均结构化输出)。
- 注: 诱导用 fixture 有 1 个 baseline 噪音 warn (meta_manually_diverged 1 entry no backing file, 我 fixture 1 个 meta entry 缺 .md), 各 state 共有, 非诱导项。
