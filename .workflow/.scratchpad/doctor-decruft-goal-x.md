# Goal X — doctor 净化 + 静默化(ready-to-execute spec)

> 从 fallback-purge 收尾 grill(2026-06-12)派生。用户拍「第 2/3 波另起干净会话」。
> 第 1 波(删 knowledge-sync 空转壳)已落 commit e037897。本 doc = 剩余第 2/3 波。
> **铁律(本会话两次踩过)**:任何"no-op/stub"删除前先 grep 验 Species A(过渡桩,删)vs Species B(防御/优雅降级,留);行号会漂,**以 grep 为准**(KT-PIT-0002)。

## 解决什么痛点(用户视角)
1. **doctor 谎报体检**:`fabric doctor` 列 ~13 项"✓ 通过"的检查,实际啥都不查(store cutover 掏空成空桩)。用户被误导以为知识库被体检了。→ 删掉,doctor 只说真话。
2. **doctor 刷屏**:一次吐 ~48 行,真问题被淹。→ 默认只显示 warn/error,全列表挪 `--verbose`。

---

## 第 2 波:删 doctor 空桩 check

### 要删的桩(doctor.ts,均返回 empty/hardcoded-empty;Species A,store cutover 注释自证)
grep `emptyXxxInspection` + `: XxxInspection = \{ (candidates|duplicates|mismatches|offenders|entries|collisions): \[\] \}` 定位。本会话核到的(行号约,以 grep 为准):
- orphanDemote / staleArchive / pendingOverdue(`empty*Inspection`)
- stableIdDuplicate `{duplicates:[]}` / layerMismatch `{mismatches:[]}` / stableIdCollision `{collisions:[]}`
- narrowNoPaths / relevancePathsDangling / relevancePathsDrift / personalLayerPathMisclassify / suspiciousKb `{candidates:[]}`
- narrowTooFew / relevanceFieldsMissing / draftAutoPromote / filesystemEditFallback / baselineFilenameFormat(`empty*` 或 `{offenders:[]}`)

每个桩牵动 5 处:① 类型定义 ② `empty*Inspection()`/hardcoded-empty 赋值 ③ `create*Check` 渲染器 ④ `runDoctorReport` 的 `checks[]` 数组条目 ⑤ `runDoctorApplyLint` 的 mutation 臂(L1652-1709 也跑这些空 inspection=死臂)。

### ⚠️ 不要删的(LIVE store-aware,非桩 —— 必须 grep 区分)
- **underseeded**(`storeKnowledgeSummaries.length`)· **summary-opaque** · **store_counter_drift**(inspectStoreCounters)· **session_hints_stale** · **skill_md_yaml** · **hooks_wired/runtime/content_drift** · **promote_ledger_invariant** · **onboard_coverage**(inspectOnboardCoverage)· **stale_serve_lock** · **global_cli** · **bootstrap anchor/L1/L2 drift** · **baseline scan evidence** 等 —— 这些读真实来源,保留。

### 级联面(删 check 牵动,务必同步)
1. **i18n 文案 key**:每个 check 有 `doctor.check.<name>.*` 在 `packages/shared/src/i18n/locales/en.ts` **和** `zh-CN.ts`。删 check → 两边都删对应 key。
   - **G-INVARIANT parity 闸**:`locale-parity.test` 钉 en=zh(当前 933)。两边删等量 key 才不破闸;删完跑 `locale-parity.test` 确认重新平衡。
2. **event_type census 闸**:`runDoctorApplyLint` 可能 emit 聚合事件(如 `relevance_migration_run`)。删 relevanceFieldsMissing 臂前确认该 event_type 是否被 `event-ledger-census.test` 钉(钉了要同步 census inline snapshot)。
3. **server doctor.test.ts 断言**:`runDoctorReport` 的 "returns ok when aligned" 测试断言 `report.checks.map(name)` = 一个**有序全列表**(含被删 check 名)→ 同步删。其它引用被删 check 名/code 的断言一并改。

### 验证
逐步 grep 验死 → 删 → `pnpm --filter @fenglimg/fabric-shared exec vitest run src/i18n/locale-parity.test.ts src/schemas/event-ledger-census.test.ts`(census 闸)→ `pnpm -r exec tsc --noEmit` → 全测试 0 fail 0 skip → commit。

---

## 第 3 波:doctor 默认静默(只显 warn/error)

### 改点
`packages/cli/src/commands/doctor.ts` 的 `renderHumanReport`(约 L661):L670 `for (const check of report.checks) { writeStdout(...) }` **无条件打印全部 check**。改为:**默认只打印 `check.status !== "ok"` 的(warn/error)**;`--verbose` 时打全部。已有 `renderTldrHeader`(top-3)+ `--verbose` flag 复用。

### 级联面(输出测试 + 快照)
动 doctor 人读输出会影响:`packages/cli/__tests__/doctor.test.ts` · `doctor-tldr-actionhint.test.ts` · `__snapshots__/i18n.test.ts.snap` · `__snapshots__/cli-surface.test.ts.snap`。逐个核对断言/快照(快照用 `vitest -u` 但**先肉眼 diff 确认变化都是"少印 ok 行"**,别盲目 -u)。

### 验证
全 cli 测试 0 fail 0 skip + 肉眼看 `fabric doctor` 输出确实只剩问题行 + `--verbose` 全列。

---

## 不做(已决定)
- 不拆 doctor.ts god-file(用户早前否了"删+拆"大重构,只删桩瘦身)。
- cosmetic over-export nit(knip 5 export+13 type+6 duplicate)跳过。
- event-ledger `auto-heal-after-drift` trigger enum 不碰(受 census 钉,留 schema 层)。

## 关联
- **Goal Y**(store-aware 读侧 lint 重实现)= 把第 2 波删掉的高价值 check 用 store 版接回。见 `store-readside-lint-reimpl-goal-y.md`。两者次序:先 Goal X 删干净诚实化, 再 Goal Y 按 per-check 价值重建。
