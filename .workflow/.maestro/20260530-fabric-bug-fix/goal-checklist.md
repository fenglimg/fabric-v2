# Goal Checklist — 20260530-fabric-bug-fix (mode ③ 混血)

> **真源是 `status.json`,本文件是投影视图 + 行动手册。** 状态变更改 status.json,不改这里。

## 目标
把当前项目所有已发现问题当 bug 全量修复,优先 TDD。统一三源:multi-perspective 45 条(ISS-20260530-001..045)+ oracle 审计 F2–F8 + 用户拍板升级 3 项。

## 终止判据(③:命名门全绿 = 自动 completed)✅ 全部达成 2026-05-31
- [x] **G-BUGS** — task_decomposition 全 45 done 且 verified
- [x] **G-TSC** — `pnpm --filter @fenglimg/fabric-shared build && pnpm typecheck` exit 0
- [x] **G-TEST** — `pnpm test` 全绿(shared 556 + server 727 + cli 881 = 2164)
- [x] **G-LINT** — `pnpm lint`(knip --strict)exit 0
- [x] **G-BUILD** — `pnpm build` 全包成功

## 执行准则(边界契约)
- 凡有明确预期行为 → **强制 TDD**:先写红测(必须真红)→ 修 → 转绿。
- 最小改动 / 不破坏向后兼容 / fix-don't-hide(禁 `as any`/`@ts-ignore`/空 catch 掩盖)。
- 改 `packages/shared/src/schemas` → 必须 `pnpm --filter @fenglimg/fabric-shared build` 重建 dist 再 typecheck。
- 并发写文件复用已存在 `appendLockedLine`(injection-log.cjs,commit 76bc350),不另造锁。
- 多-LLM review 给 suggested fix → verbatim 采纳 + trade-off 注释。

## Wave 执行顺序
**W1 先行(咬用户自己 / 伤下游 / 改动小)** — 12 task
- W1-01 hook 裸 append 加锁(ISS-011/012/015)
- W1-02 allocator 跨进程串行(ISS-013)
- W1-03 损坏 meta 不覆盖(ISS-014)
- W1-04 findTestFiles 缓存(ISS-003)
- W1-05 buildKnowledgeMeta 缓存(ISS-004)
- W1-06 events.jsonl redirect 缓存(ISS-005)
- W1-07 排序去 score-in-sort(ISS-006)
- W1-08 F2 install 保留用户 hook
- W1-09 ISS-042 install 写 .gitignore
- W1-10 F5 extract-knowledge parse
- W1-11 F8 --fix-knowledge 尊重 --dry-run
- W1-12 ISS-030 接上 actionHint 渲染

**W2 install/uninstall 对称 + 升级项 + 中等** — 9 task
- W2-01 F3 / W2-02 F4 / W2-03 F7 / W2-04 F6 / W2-05 toml保留键 / W2-06 http-exp broken import / W2-07 --force-skills-only 7 / W2-08 ISS-017 extractBody / W2-09 ISS-043 redaction

**W3 本地安全 + perf 余项 + 体验毛刺** — 9 task
- W3-01 ISS-001 YAML / W3-02 ISS-002 git-- / W3-03 perf余项 / W3-04 git反馈 / W3-05 i18n / W3-06 token hint / W3-07 ASCII箭头 / W3-08 FORCE_COLOR / W3-09 doctor TL;DR+forensic进度

## Deferred(显式 defer,记 rationale,非阻塞)
见 status.json `deferred_enhancements`:扩展性簇(ISS-023~029 待规模信号)、维护性重构(ISS-018)、cleanup(ISS-019/020/022 归 G-LINT 收口)、ISS-021/041/044/045/016、F1(doc-drift)。

## Resume
续跑:调 `/goal-mode continue`(推进一个 task → TDD 红→绿 → 跑 verification → 原子更新 status.json → 重检终止 gate + drift gate → 未达成自调下一步)。每 5 task close 自检 drift。
