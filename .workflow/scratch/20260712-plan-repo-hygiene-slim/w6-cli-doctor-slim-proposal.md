# Doctor W6: CLI doctor 再瘦 — 方案 only（本轮不落地）

## 为什么没落地
1. `packages/cli/src/commands/doctor.ts` 里 **渲染 / 编排 / 交互确认 / store diagnostics 收集** 缠在一起。
2. 只外提 `renderDoctorHeader/Checks/StoreHealth` 时仍会误伤：
   - `shortHint` 被 `renderActionableDigest` 依赖
   - `writeStdout` 与渲染混用
   - `FixKnowledgePlan` 形状在 render 与 `computeFixKnowledgePlan` 两侧必须一致
   - `renderDoctorFilteredHelp` 被 `src/index.ts` 直接 import
3. 本轮多次半拆导致 tsc/vitest 红；按零回归原则 **整文件回滚**。

## 建议拆分边界（后续）
| 模块 | 职责 | 依赖 |
|------|------|------|
| `doctor-render.ts` | 纯字符串/打印：header / checks / store-health / filtered-help / shortHint | paint, structure, t |
| `doctor-fix-plan.ts` | `computeFixKnowledgePlan` + plan 文案 + consent | DoctorReport, clack |
| `doctor.ts` | 仅 citty 命令：resolve target → report → fix → metrics → exit | server APIs |

## 落地顺序
1. 先加 CLI 渲染单元测试的 **导入路径** 锁定（`doctor-reskin.test.ts` 已有）。
2. 一次 PR 只搬「纯函数 + 已有 export」：`renderDoctorHeader/StoreHealth/Checks/FilteredHelp` + 它们的私有依赖。
3. 第二 PR 再搬 fix-plan/consent。
4. 每 PR：`vitest doctor.test + doctor-reskin` + `tsc` + knip。

## 本轮状态
- **未改** `packages/cli/src/commands/doctor.ts`
- W4 cite-coverage 物理拆分已提交：`b7bb4389`
