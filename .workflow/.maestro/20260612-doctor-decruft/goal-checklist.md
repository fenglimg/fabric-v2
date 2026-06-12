# Goal Checklist — doctor 净化 + 静默化 (mode ③ 混血)

> status.json 是真源,本文件是投影。**完整行动手册 spec**:
> `.workflow/.scratchpad/doctor-decruft-goal-x.md`(精确删除清单 + 级联面 + 不删的 LIVE check + 验证)。

## 目标
让 `fabric doctor` ① 别**谎报体检**(删 ~13 个 store-cutover 掏空的空桩 check)② 别**刷屏**(默认只显 warn/error)。命名 gate 全绿即自动 completed。

## 命名 Ship Gate(全绿即达成)
- [ ] **G-HONEST** — doctor 不再列空桩 check(~13 个 empty*Inspection/{...:[]} 删净)
- [ ] **G-QUIET** — doctor 默认只显 warn/error,全列表挪 `--verbose`
- [ ] **G-GREEN** — tsc ✓ + 全测试 0 fail 0 skip + census/parity 闸绿

## 任务
- [ ] **W2** 删空桩 check + 全级联(i18n en/zh 等量删→parity 重平衡 / event census / checks[] / apply-lint 死臂 / 类型 / server doctor.test 断言)→ G-HONEST + G-GREEN
- [ ] **W3** doctor 默认静默(renderHumanReport gate on --verbose)+ 同步输出测试/快照(快照 -u 前肉眼 diff)→ G-QUIET + G-GREEN

## 铁律(本会话两次踩前提失真的教训)
- 删任何 "no-op/stub" 前 **grep 验 Species A(删)vs B(留)**;行号会漂,**以 grep 为准**(KT-PIT-0002)。
- i18n 删 key **en+zh 等量**,删后跑 `locale-parity.test` 确认 en=zh 平衡(G-INVARIANT 闸)。
- 删 apply-lint 臂前确认聚合事件(relevance_migration_run 等)是否被 event-ledger-census 钉。
- 防 false-green:删 check 后全测试无悬空断言;快照 -u 前肉眼 diff 确认只是"少印 ok 行"。
- **不删** LIVE store-aware check(见 spec §不要删)· **不拆** god-file · **不碰** event-ledger trigger enum。

## 关联(本 goal 之外, 各有 backlog)
- **Goal Y** store 版读侧 lint 重实现 → `.scratchpad/store-readside-lint-reimpl-goal-y.md`(本 goal 删完之后做)
- **内容层 i18n** → `.scratchpad/content-i18n-deferred-goal.md`

## Resume
`cd /Users/wepie/Desktop/personal-projects/pcf-fallback-purge` → 读本文件 + `.scratchpad/doctor-decruft-goal-x.md` → `/goal-mode continue`。
