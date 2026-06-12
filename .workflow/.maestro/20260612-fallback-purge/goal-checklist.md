# Goal Checklist — fallback/兜底 大清除 (mode ③ 混血)

> status.json 是真源,本文件是投影视图。行动手册 spec:
> `.workflow/.scratchpad/fallback-purge-plan.md`(14 决策+4波次) · `wave0-triage.md`(逐符号定性+测试耦合事实)

## 目标
0 用户阶段清除 **Species A**(历史包袱/架构残留/过渡态兜底),保留 **Species B**(运行时防御)。
命名 ship gate 全绿即自动 completed。

## 命名 Ship Gate(全绿即达成)— 3/6 绿
- [ ] **G-BASELINE** — 全量测试 0 fail & 0 skip(当前 0 fail / 97 skip;skip 需 W0-2 聚焦相位)
- [x] **G-INVARIANT** — census 闸 4/4 绿(i18n parity + event_type 57成员 + knowledge-enum 5/3/2 + MCP既有)(e4dc626/c056570)
- [ ] **G-DEADCODE** — 部分:extractBody+LockState 死type 已删;余 co-location 死簇+KnowledgeMetaBuildSource → W1-1 聚焦相位
- [x] **G-MIGRATION** — Species A 迁移/兼容 grep 零残留(4 surface 0;W2-1a/b/c + W2-2)✅
- [x] **G-VOCAB** — cite-tag LEGACY_CITE_TAG_REMAP 删净 + shared rebuild + parser 测试绿(87ed337;bootstrap文案残留→ADJ-3)✅
- [ ] **G-GREEN** — tsc --noEmit ✓ + 全量测试全绿(tsc✓/fail0,但 G-BASELINE 97skip 阻塞)

## 边界契约
- **IN**:Species A 删除 · 测试基线收绿 · census 不变式闸
- **OUT**:Species B 防御(保留) · 半成品 sync 推送(ADJ-1 用户拍) · stable/endorsed rename(ADJ-2 用户拍) · over-export 外观 nit(可选)
- **铁律**:先验死代码(零caller)→灰区先收尾cutover再删 · 动态派发靠census闸非grep · TDD-red先写不变式 · 每波commit · 改shared rebuild dist · knip unused≠死(必grep验)

## 任务(已知面,live-ledger 可增长)
**Wave 0 基线+安全闸**
- [x] W0-1 14红 → 真根因=测试非hermetic+pipeline硬编码CJK绕过t();修=FABRIC_HOME隔离+pin FAB_LANG+接线t() (bc451de) → G-BASELINE
- [ ] W0-2 99 server skip 逐个 triage(复活/随死代码删)→ G-BASELINE+G-DEADCODE
- [x] W0-3 census 闸 4/4(i18n parity/event_type 59/knowledge-enum 5·3·2/MCP既有)(c056570) → G-INVARIANT
**Wave 1 死代码外科删除**(与 W0-2 耦合)
- [ ] W1-1 删 co-location 死簇 + 连带 fixture(保留 deriveRuleIdentity/extractRuleDescription)→ G-DEADCODE
- [ ] W1-2 摘死 type + 精验 computeExposedAndMutated → G-DEADCODE
**Wave 2 Species A 迁移**
- [ ] W2-1 删旧 marker/.cursor 扁平/MCP TOML 归一化 → G-MIGRATION
- [ ] W2-2 删 config maturity 别名(留 doctor 内部决斗)→ G-MIGRATION
**Wave 3 vocab shim(小心)**
- [ ] W3-1 删 cite-tag remap + 全 tendril + rebuild shared + 同步测试 → G-VOCAB
**已完成**
- [x] W1-pre 删 recall.ts 死 re-export extractBody (d7eba65)

## 待裁决(round 末批量浮,非阻塞)
- ADJ-1 半成品 sync 推送:删/接完/留
- ADJ-2 doctor 内部 stable/endorsed rename:做/不做
- ADJ-3 bootstrap-canonical byte-locked zh-CN AGENTS.md(en 用户拿中文):彻底 i18n 化需推翻 byte-lock 契约,做/不做

## Resume(2026-06-12 第二会话收口 — 选项A 4项全done)
**本会话成果**:W2-1(a/b/c)+ W2-2 + W3-1 + W1-2 全 done(7 commit c7a4e57..8791f94)。
**3/6 gate 绿**:G-INVARIANT · G-MIGRATION · G-VOCAB。全程 tsc✓ + shared628/server693(97skip)/cli1047。
**跨-LLM review 已验**(gem-145715):5 purge wave 全 True Species A,无 Species B 误删,无 dangling(legacy-serve-lock-probe proxy 是 live 非死,refute)。

**ADJ 终态(用户已拍)**:
- ADJ-1 半成品 sync 推送 → **删**(clean-slate,需要时 TDD 重建)
- ADJ-2 stable/endorsed rename → **不做**(defer,触到再改)
- ADJ-3 bootstrap byte-lock → **码层全做**(已);byte-lock i18n 彻底化 OPEN;legacy-tag 文案行残留待处理
- ADJ-4 isForbiddenCrossLayerEdge → **保留**(未接线 Species B 隐私防御,W1-1 删簇时 EXCLUDE)

**剩余工作(新终端聚焦相位)**——目标 = 推绿 G-DEADCODE / G-BASELINE / G-GREEN:
1. **ADJ-1 删 sync 推送**(快;run-sync.ts defaultPush/defaultCommitDirty/Git* + 测试;grep 验零 caller 先)
2. **W0-2 ~90 skip 复活**(主体大块;逐 check family 重写 store fixture→解 skip→防 false-green round-trip;见 `.scratchpad/w0-2-skip-triage.md`)→ G-BASELINE
3. **W1-1 co-location 死簇删除**(阻塞于 W0-2 解 skip 后删 fixture;含 KnowledgeMetaBuildSource;**EXCLUDE isForbiddenCrossLayerEdge** 按 ADJ-4 保留)→ G-DEADCODE
4. **ADJ-3 残留**:BOOTSTRAP_CANONICAL legacy-tag 文案行修正(需先定 byte-lock i18n 方向)
- 每步:先 grep 验死 → census 闸兜底 → 改 → tsc + 全量测试绿 → git commit → 原子更新 status.json → 重检 gate。

续跑:`cd /Users/wepie/Desktop/personal-projects/pcf-fallback-purge` → 读本文件 + `.scratchpad/w0-2-skip-triage.md` + `wave0-triage.md` → `/goal-mode continue`。
