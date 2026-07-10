# Fabric 归档策略修正 — 实现 brief

> 来源: 2026-06-18 两轮 /grill-me 收敛的设计共识。本文件供新会话/maestro 当实现上下文。
> 目标读者: 一个对本仓不熟的执行者。先读这份,再读引用的 file:line。

## 背景一句话

Fabric 的"会话内归档 vs 跨会话归档"策略当前 shipped 实现有 4 道结构裂缝 + 2 个不可消除的 LLM 判断核。
本任务 = 把**确定性的 4 块做到结构正确**,把 2 个判断核收敛到**有界的人/LLM 兜底**(不强求完美)。

## 核心洞察(实现时的指北针)

**知识的真身份是 `(type, slug)` 内容,会话只是收集与归属的容器。**
当前 `idempotency_key = sha256({source_session, type, slug})` 把 source_session 焊进身份,是所有跨会话重复的原罪。
该 key 已 **FROZEN(磁盘兼容,不可改公式)** —— 见 `packages/server/src/services/extract-knowledge.ts:278`、注释 `:169-175`。
所以修复**不能动 key 公式**,只能在 anchor / 信号 / 去重 / 可见性层把"内容身份"补回来。

## 两车道目标模型

- 🅰 **会话内(in-session)— 主打"准"**:1) 主力 = self-archive policy(看内容,实时抓);2) 兜底 = 按会话计数 nudge。
- 🅱 **跨会话(cross-session)— 主打"漏"的安全网**:独立 backlog 信号 + `fab_archive_scan` 多会话拼接(已正确,水位线随会话推进)。

## 4 个确定性修复任务(本次 scope)

### 裂缝 1 — 计数 anchor 必须按会话
- 现状: `fabric-hint.cjs` Stop hook 的 archive 计数用**全局** anchor(所有会话最近一次 `knowledge_proposed`),且数的是 session-blind 的 `.fabric/.cache/edit-counter` 文件。
  - anchor 计算: `packages/cli/templates/hooks/fabric-hint.cjs:2126` 附近(`EVENT_TYPE_PROPOSED` 反向扫)。
  - 计数: `countEditsSince` @ `fabric-hint.cjs:470`;edit-counter 行 shape = `{ts, paths}` **无 session_id**。
- Bug: 隔壁窗口 A 归档 → 全局 anchor 前移 → 本窗口 B 的未归档计数被清零 → B 的活静默遗忘。
- 修法: 计数**改从带 session_id 的事件账本取**(file-mutation 事件由 `post-tooluse-mutation.cjs:206 appendFileMutated` 写,含 session_id);**anchor 改成本会话自己上次 `session_archive_attempted.covered_through_ts`**(无则从本会话首次活动)。
- 影响文件: `fabric-hint.cjs`(+ 两端副本 `.claude`/`.codex` + `templates/hooks/`);测试 `packages/cli/__tests__/knowledge-hint-broad.test.ts` 同族。
- 注意: 三端 hook 副本(.claude/.codex/templates)必须同步改,install 会从 templates 同步。

### 裂缝 2 — 跨会话 sweep 用独立 backlog 信号
- 现状: 跨会话兜底靠全局 24h 计时器(距任意会话最近一次 `knowledge_proposed`)。per-session 化后,只要每天有任意会话归档,这个 24h 永不触发 → 低于阈值就结束的"死会话"被无限孤儿化。
- 修法: 新增**独立 backlog 信号** — 数"有未归档高价值活、且**已 `session_ended`**(或 idle >X 小时兜底)的会话数",达 N 提议跨会话 sweep。不被"任意会话刚归档"重置。
  - `session_ended` 是真事件: `packages/cli/templates/hooks/session-end-marker.cjs`(SessionEnd hook 写 `{event_type:"session_ended", session_id, ts}`)。优先用它,idle 仅兜底。
- 该信号是承重安全网,**不是小字**;在 Stop hook 信号优先级里给它正式位置(现有 archive>review>import,见 `fabric-hint.cjs` decide())。

### 裂缝 3 — 把归档水位线/被跳过会话亮给用户(便宜版 recall 兜底)
- 现状: `fab_archive_scan` 已返回 `dropped[]`(每个被跳过会话 + 原因: user_dismissed/cooldown/no_new_signal)+ `covered_through_ts`,见 `packages/server/src/services/archive-scan.ts:118-160`,但 fabric-archive 用户输出没亮出来。
- 修法: 在 fabric-archive skill 输出 + (可选)nudge 里展示"会话 X 已归档至 T / 会话 Y 跳过(原因)",让人当 recall 检测器、可手动 override。
- 贵版(周期多-LLM 冷评测漏报率)**本次不做**,记 deferred。

### 裂缝 4 — `(type, slug)` 确定性合并跨会话重复 pending
- 现状: review 端只有 LLM 主观语义去重、且只比 canonical、不 pending-vs-pending 互查(`fabric-review/SKILL.md:102-118`)。跨会话双胞胎(source_session 不同 → key 不同 → 两个 pending)结构上 collapse 不掉。
- 修法: 在 scan 或 review 时,**确定性**检测共享 `(type, slug)` 但 source_session 不同的 pending 条目 → 合并(union `source_sessions` + 合并 evidence)。不动 frozen key。
  - 残留(诚实标注): 只抓**字面 slug 相同**;两窗口给同一决策起不同 slug 仍落回 LLM 语义层。这是判断核,不在本次确定性 scope。

## 不可消除的 2 个判断核(本次不解,文档标注为已知边界)

1. **Recall 核** — "对话里有没有该归档的知识" 是判断题,无算法保证不漏 → 便宜版人兜(裂缝3),冷评审计 deferred。
2. **语义同一核** — "两条是不是同一条" 字面 `(type,slug)` 只抓 exact,语义同一仍需 LLM。

## 边界契约

- **in scope**: 裂缝 1/2/3(便宜版)/4(确定性部分)的实现 + 测试 + 三端 hook 副本同步。
- **out of scope**: 改 frozen idempotency 公式;贵版冷评 recall 审计;语义 slug 归一;改底层事件账本 schema(只新增消费,不改写入除非裂缝1必需的 session_id 已存在)。
- **constraints**: hook 永不 block(KT-DEC-0007 reminder-only);三端副本字节同步;改 server 类型后必 rebuild dist(本仓既有 lesson);release 前本地 `pnpm -r exec tsc --noEmit` + `pnpm lint` + `pnpm test`。

## 验证

- 裂缝 1/2/4: deterministic 单测(并发场景: 模拟两 session 事件账本,断言 B 计数不被 A 归档清零;断言 (type,slug) 双胞胎合并成一条)。
- 裂缝 3: 输出快照测试 + dogfood。
- 全量门: tsc --noEmit / knip / vitest 三绿。
