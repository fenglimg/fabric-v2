# Doctor W5: CheckSpec 注册表 — 方案 only（本轮不落地）

## 为什么没落地
1. 尝试把 `buildDoctorChecks` 的数组改成 `DOCTOR_CHECK_BUILDERS` 时，**顺序/展开语义**（`...spread`、条件 `null`）极易漂移。
2. `doctor-i18n.test.ts` 的 snapshot **依赖 checks 稳定顺序**；顺序一变即红。
3. 机械注释/调用切分多次产出损坏的 TS（注释被拆进 builder 表达式）。

## 安全落地条件（后续 milestone）
1. **先**加顺序锁定测试：`report.checks.map(c => c.name)` 对固定 fixture 的全量快照（en/zh 各一，或只锁 `code`/`name` 序列）。
2. 注册表项类型：
   ```ts
   type CheckSpec = {
     id: string;
     build: (ctx: DoctorCheckBuildContext) => DoctorCheck | DoctorCheck[] | null | undefined;
   };
   ```
3. 转换策略：
   - 单次机械转换必须 **整块 return 数组 → 整块 builders**，用 AST（ts-morph）而不是按行 split 注释。
   - 转换后第一件事：跑 `doctor-i18n` snapshot + `doctor.test` 全量。
4. **不要**先拆到独立文件再改顺序；先 in-file registry，再外提。

## 非目标
- 改变任意 check 的 severity / code / 文案
- 并行化检查（语义可能依赖顺序时先别做）
