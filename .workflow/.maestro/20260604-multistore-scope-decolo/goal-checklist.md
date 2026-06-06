# Goal: Multi-store scope 接线 + co-location 退役

**mode**: ③ 混血 · **session**: 20260604-multistore-scope-decolo · **branch**: feat/multistore-scope-decolo
**真源**: `status.json`(本文件是投影视图,冲突以 status.json 为准)

## 终态(命名验收门全绿 = 自动 completed)

| Gate | 通过判据 |
|---|---|
| G-PROJECT | store project 可列举/创建/绑定,绑不存在的 project 被拦 |
| G-WRITE-SCOPE | 新写入 frontmatter 含 `semantic_scope`+`visibility_store`;personal 不入 shared store |
| G-FILTER | recall 只召回 当前 `project:<id>` + 非-project 坐标(team/personal),挡掉别 project 专属 |
| G-RANK | plan-context 排序消费 `resolveCandidates`(project>team>personal + store tie-break) |
| G-MIGRATE | 存量 100% 带 scope 字段 + 零脏 layer + 零 personal 混进 team store |
| G-DECOLO | `agents.meta.json` 零读者(测试/迁移脚本除外)+ doctor/工具全读 store |
| G-INSTALL | install 不再建 co-location 空柜子 |
| G-GUARD | doctor 三类 scope lint 生效 + re-scope/promote 工具可用 |
| G-GREEN | shared rebuild + `pnpm -r exec tsc --noEmit` 全绿 + 全测试通过 |

## Wave 与依赖

```
W1 写入侧+project实体   A2(registry) → A1(写入落scope)         → G-PROJECT / G-WRITE-SCOPE
W2 读取侧               A3(recall+project过滤) → A4(排序接入)   → G-FILTER / G-RANK      [依赖 W1]
W3 数据迁移(clean-slate) A5(补scope+修脏layer)                  → G-MIGRATE              [依赖 W1 schema 定型]
W4 co-location 退役     B1(doctor读store) B2(工具读store) B3(meta退役) B4(install) → G-DECOLO/G-INSTALL [依赖 W3]
W5 守卫+工具            A6(doctor lint) A7(re-scope/promote)    → G-GUARD                [依赖 W4]
收口                    Z1(tsc+test+删旧柜子+rebuild)           → G-GREEN                [依赖 all]
```

## 执行准则(constraints)

- 改 shared schema → 必须 `pnpm --filter @fenglimg/fabric-shared build` 重建 dist(否则 runtime invalid)
- 收口前本地跑 `pnpm -r exec tsc --noEmit`(CI tsc ≠ 本地 build,历史复发 3 次)
- 每 wave 收口即 `git commit` + sha 回填 `status.json` git_commits[]
- deferred 项不搁置:用 TDD 或行为保持验证
- **personal scope 条目绝不写入 shared store**(R5#3 隐私红线)
- W4 退役用 **loop-until-dry**:grep `agents.meta.json` 读者 → 改 → 重 grep,连续 2 轮无新隐藏读点才算 G-DECOLO 干净

## 边界

- **in**: scope schema 消费接线 / resolution 接入 / recall+写入+doctor 改造 / store project registry / 存量迁移 / agents.meta 退役
- **out**: org/联邦层级 · 个人库 per-project · hook scope 可视化 · 向量召回 · 兼容映射(走 clean-slate)

## Resume

**状态(2026-06-04):partial-complete — 用户决策先收口 W1–W3,W4/W5 另起专注 goal。**

已完成(5/9 门全绿,3 commit):
- W1 `ab12edb` — A2 store project registry + A1 写入落 semantic_scope/visibility_store → G-PROJECT / G-WRITE-SCOPE
- W2 `a33228e` — A3 recall project 过滤 + A4 resolveCandidates 排序 → G-FILTER / G-RANK
- W3 `ead4339` — A5 scope-backfill 工具 + repo 22 条回填 → G-MIGRATE
- 全量 tsc clean + 2375 测试(shared568/server828/cli979)0 fail

Deferred → **W4 followup goal**(大型地基重构,单独一轮):
- B1 doctor 读 store · B2 ~20 工具读 store(loop-until-dry)· B3 agents.meta 退役 · B4 install 不建空柜子 → G-DECOLO / G-INSTALL
- A6 doctor scope lint(缺 scope/personal 泄露/dangling project ref)· A7 re-scope/promote 工具 → G-GUARD
- Z1 9/9 完整收口 + dogfood → G-GREEN
- **难点锚**:agents.meta 是 counter/id 账本(KT-DEC-0004)+ 旧召回索引,~20 生产文件 + 800+ 测试深度依赖;退役需把 counter 改 per-store 派生(store-migrate.buildStoreIdIndex 已有雏形)+ plan-context 去 projectRawItems + doctor/id-allocator/sync 全切 store。

续 W4:新开 `/goal-mode "退役 Fabric co-location/agents.meta,doctor+工具全读 store,install 不建空柜子"`(mode③,gate=G-DECOLO/G-INSTALL/G-GUARD/G-GREEN)。
