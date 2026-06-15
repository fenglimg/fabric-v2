# T1 证据 — G-MACHINE 全绿 + G-PERF 延迟基线 (2026-06-15)

## G-MACHINE (维度1 正确性) — 全绿
| 检 | 结果 |
|---|---|
| build (pnpm -r build) | ✓ exit 0 |
| typecheck (tsc --noEmit) | ✓ exit 0 |
| lint (knip --strict) | ✓ exit 0 |
| test (vitest run) | ✓ 2403 passed / 0 failed / 216 files (shared 637 / server 718 / cli 1048) |
| test:strategy | ✓ PASS |
| store-only-e2e | ✓ verdict=pass (修 F1 后) |

注: cross-client-parity 含 cursor 分支照跑绿。Cursor 砍除由外部分支处理,合 main rebase 后复跑。

## F1 (gate 陈旧 false-red, severity medium, 已修)
store-only-e2e.mjs:199 硬编码 storeRoot=stores/<alias>,真实布局 stores/<group>/<mount_name>。
approve 正确写入 stores/team/team/...,gate 路径少 mount_name 段 → false-red。
修法: 复用 shared.storeRelativePathForMount(team)。

## G-PERF (维度4) — 延迟基线 (perf-benchmark.mjs, N=10)
| 面 | p50 | p95 | 闸 | 判 |
|---|---|---|---|---|
| CLI 冷启 | 275ms | 308ms | ≤2000ms | ✓ |
| Hook 冷启 | 137ms | 143ms | ≤500ms | ✓ |

PENDING(T2): recall payload size + hook 注入 size 测量与阈值。
实时实证: 本会话 fab_recall 返回 29333B,超 16KB warn 阈值(brief finding #3, KT-DEC-0019 description-first 疑回退)。
