# Goal Checklist — fallback/兜底 大清除 (mode ③ 混血)

> status.json 是真源,本文件是投影视图。行动手册 spec:
> `.workflow/.scratchpad/fallback-purge-plan.md`(14 决策+4波次) · `wave0-triage.md`(逐符号定性+测试耦合事实)

## 目标
0 用户阶段清除 **Species A**(历史包袱/架构残留/过渡态兜底),保留 **Species B**(运行时防御)。
命名 ship gate 全绿即自动 completed。

## 命名 Ship Gate(全绿即达成)
- [ ] **G-BASELINE** — 全量测试 0 fail & 0 skip(当前 14 fail / 105 skip)
- [ ] **G-INVARIANT** — census 不变式安全闸建立且全绿(event_type/i18n/layer-type/MCP)
- [ ] **G-DEADCODE** — co-location 死簇 + 死 type 删净(当前 1/5,recall extractBody 已删)
- [ ] **G-MIGRATION** — Species A 迁移/兼容 grep 零残留
- [ ] **G-VOCAB** — cite-tag remap + tendril 删净 + shared rebuild + parser 测试绿
- [ ] **G-GREEN** — tsc --noEmit ✓ + 全量测试全绿

## 边界契约
- **IN**:Species A 删除 · 测试基线收绿 · census 不变式闸
- **OUT**:Species B 防御(保留) · 半成品 sync 推送(ADJ-1 用户拍) · stable/endorsed rename(ADJ-2 用户拍) · over-export 外观 nit(可选)
- **铁律**:先验死代码(零caller)→灰区先收尾cutover再删 · 动态派发靠census闸非grep · TDD-red先写不变式 · 每波commit · 改shared rebuild dist · knip unused≠死(必grep验)

## 任务(已知面,live-ledger 可增长)
**Wave 0 基线+安全闸**
- [x] W0-1 14红 → 真根因=测试非hermetic+pipeline硬编码CJK绕过t();修=FABRIC_HOME隔离+pin FAB_LANG+接线t() (bc451de) → G-BASELINE
- [ ] W0-2 99 server skip 逐个 triage(复活/随死代码删)→ G-BASELINE+G-DEADCODE
- [ ] W0-3 建 census 不变式闸 → G-INVARIANT
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

## Resume
新会话续跑:`cd /Users/wepie/Desktop/personal-projects/pcf-fallback-purge` → 读本文件 + 两份 spec → `/goal-mode continue` 推进下一步(单步:推进一 task → verification → 原子更新 status.json → 重检 gate)。
