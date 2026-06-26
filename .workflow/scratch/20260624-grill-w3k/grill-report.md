# Grill Report: W3-K · MCP 工具拓扑收尾(面向 AI agent 契约)

**Session**: 20260624-grill-w3k
**Depth**: standard (5 branches)
**Date**: 2026-06-24
**Upstream**: census §3 (`.workflow/.maestro/20260623-fabric-ux-census/gap-census.md`) + NS-03 #6-10 + 03-mcp 审计

## Discovery Summary

### Codebase Surface (grounded 2026-06-24,Explore + node/rg 实证)

MCP server (`packages/server/src/index.ts:239`) 注册 **4 个工具**,schema 全在 `packages/shared/src/schemas/api-contracts.ts`:

| 工具 | 文件 | action/mode | readOnlyHint | 截断/dropped 字段 |
|---|---|---|---|---|
| `fab_recall` | recall.ts | 单发(无 action) | **true** | `omitted_candidate_count`(裸 number) |
| `fab_archive_scan` | archive-scan.ts | 单发 | **true** | `dropped[]{session_id,reason-enum}` ✅ 已是结构化 |
| `fab_propose` | extract-knowledge.ts | 单发 | false(写) | — |
| `fab_review` | review.ts | **action 8 值** | false(含 5 写动作) | — |

`fab_review` 8 action:`list`/`search`(读)+ `approve`/`reject`/`modify`/`modify-content`/`modify-layer`/`defer`(写)。
**4 个工具全部同时构建 `structuredContent` + `content[].text`(后者是 response 的完整 `JSON.stringify`)** —— 即 double-payload(recall.ts:88 / archive-scan.ts:43 / extract-knowledge.ts:60 / review.ts:66 各 1 处)。
错误处理:**4 个 handler 全是裸 re-throw,无结构化 error envelope**。`audience` 用 `SCOPE_COORDINATE_PATTERN` 正则,失败给 zod 通用消息(无合法示例)。

### census §3 六候选 × grounded 对账(别信 census 字面)

| # | census 说 | grounded 实证 | 处置 |
|---|---|---|---|
| **K1** | modify 三件套 → 单 modify(changes.layer 自动路由) | **🔴 反转**:单 `modify` 本就按 `changes.layer` 自动路由(review.ts:915);rc.37 **故意新增** `modify-content`/`modify-layer` 显式变体来强制调用方表意。census K1 = **撤销一个 rc.37 的深思决定** | 🥊 **核心 frame 拷问**:显式表意(现状)vs 自动路由(census),谁赢? |
| **K2** | 抽只读 `fab_pending`(list/search),fab_review 只留写 | ✅ 真活儿未做。fab_review 现读写混装,readOnlyHint:false | 🔍 grill:新工具名跨端代价 vs hint 诚实 |
| **K3** | fab_archive_scan 合并进 fab_propose 的 mode=scan | **🔴 与 K2 自相矛盾**:scan 是 readOnlyHint:**true**,propose 是写;合并会**摧毁 scan 的只读 hint** —— 正是 K2 在别处想修的东西 | 🥊 **矛盾拷问**:K3 违背 K2 自己的原则 |
| **K4** | content[].text→单行摘要,消除 double-payload(recall.ts **3 处** JSON.stringify) | **数字错**:不是 recall 内 3 处,是 **4 个工具各 1 处**(double-payload 是全局模式)。问题更广。这正是我先前看到 recall 19KB payload warning 的根源 | ✅ 真活儿,比 census 更广 |
| **K5** | error envelope {error,action_hint} + audience 失败给合法示例 | ✅ 真活儿未做。无任何结构化 error;audience 失败给 zod 通用消息 | 🔍 grill:MCP SDK 已翻译 throw,自定义 envelope 值不值 |
| **K6** | omitted_count → dropped[]{id,reason} | ✅ 真活儿,**但好形态已存在**:archive_scan 的 `dropped[]{session_id,reason-enum}` 就是范本;K6 = 把它推广到 recall 的 omitted_candidate_count | ✅ 真活儿,低成本(照抄已有形态) |

### 跨端 wire 契约 blast radius(migrate-before-delete 范围)

改任何工具名/形状 → 破坏 skill 调用点。grounded 命中:
- `fab_review`:`fabric-review`(全 action 主消费)/ `fabric-connect`(modify 建 related 边)/ `fabric-import`(search+modify)
- `fab_propose`:`fabric-import`(allowed-tools 声明)/ `fabric-archive`
- `fab_archive_scan`:`fabric-archive`(scan 阶段)
- `fab_recall`:`fabric-connect`(include_related)+ 全 session 的 AGENTS.md/prompt
- 还有 `lib/shared-policy.md`(4 工具名列为 protected token,never translate)+ 各 skill `ref/*.md` + 测试 fixture

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries (K1 frame + 哪些 K 入 scope) | 🟢 Done | K1 superseded | — |
| 2 | Data Model & State (K2/K3 读写拓扑 + 矛盾) | 🟢 Done | K2 做 / K3 弃 | fab_pending 形态 |
| 3 | Edge Cases & Failure Modes (K4 double-payload + K5 error) | 🟢 Done | K4 做 / K5 做 | — |
| 4 | Integration & Dependencies (跨端 wire blast radius) | 🟢 Done | K6 做 + 统一词汇 | — |
| 5 | Migration & Rollback (wire 契约版本化) | 🟢 Done | 分两批 + 验证门 | — |

---

## Branch 1: Scope & Boundaries

**Status**: 🟢 Done

### Q1.1: K1 — 改 pending 的 modify 拓扑:三显式动作 vs 单自动路由?

**Answer**: 保持现状的三显式动作(`modify-content` 绝不翻 layer / `modify-layer` 必翻)。K1(砍回单自动路由 modify)**不做**。
**Evidence**: review.ts:915 单 modify 已按 changes.layer 自动路由;rc.37 故意新增 modify-content/modify-layer 显式变体强制表意,防 AI 误翻 layer 重分配 stable_id 伤 cite 历史(同 K2 想要的 readOnlyHint 诚实方向一致)。
**Decision**: **locked** — K1 superseded
**Constraint**: fab_review MUST 保留 modify-content / modify-layer 显式动作分离;MUST NOT 为缩减 action 数把 layer-flip 退回隐式自动路由。

### Q1.2: 本次 W3-K 的 PR 边界?(code-derived,NS-03)

**Answer**: W3-K 是**单独一个 wire-contract PR**,且 NS-03 建议"单独 grill 后再 PR"(本 grill 即是)。改任何工具名/形状 = 跨端契约变更,必须 migrate-before-delete(同步 skill 文案 + shared-policy.md + ref/*.md + 测试 fixture)。
**Evidence**: census §3 抬头;Explore 实测 blast radius(fab_review 被 3 skill 调 / fab_propose 被 2 skill / shared-policy.md 列 4 工具名为 protected token)。
**Decision**: **locked**
**Constraint**: W3-K 的任何工具名/形状变更 MUST 在同一 PR 内同步所有 skill 引用点 + shared-policy.md + ref 文档,且 MUST NOT 在工具名未迁移前删旧名。

## Branch 2: Data Model & State

**Status**: 🟢 Done

### Q2.1: 读/写该不该分成独立、各自诚实标签的工具?

**Answer**: 读写分家。**做 K2**(把 fab_review 的 list/search 读动作抽成新只读工具 `fab_pending`),**不做 K3**(archive_scan 保持独立只读,不并入写工具 propose)。
**Evidence**: archive_scan 现 readOnlyHint:true(archive-scan.ts annotations)/ fab_review 读写混装故 readOnlyHint:false / fab_propose 写。K3 把只读并入写工具会摧毁 readOnlyHint,与 K2 的诚实标签原则自相矛盾(grounded 矛盾)。
**Decision**: **locked**
**Constraint**: 读路径 MUST 与写路径分属不同工具且只读工具 MUST 标 readOnlyHint:true;MUST NOT 把只读 archive_scan 并入写工具。

### Q2.2: fab_pending 拆分后的具体形态?(derived)

**Answer**: 新工具 `fab_pending` 承接 `list` + `search` 两个读动作(保留 action 判别),标 readOnlyHint:true / idempotentHint:true。`fab_review` 收敛到 6 个写动作(approve/reject/modify/modify-content/modify-layer/defer),annotation 仍 readOnlyHint:false 但语义更诚实(纯写)。
**Evidence**: review.ts action 枚举 list/search 为读、其余为写;archive_scan 的只读 annotation 范本可复用。
**Decision**: **locked**
**Constraint**: `fab_pending` MUST 复用 fab_review 原 list/search 的 filters 形状(零行为变更,仅迁工具名);迁移 MUST 同步 fabric-review / fabric-import skill 的调用点(action="list"/"search" → fab_pending)。
**Risk**: 新工具名 `fab_pending` 是跨端契约新增 → fabric-review / fabric-import / shared-policy.md / ref 文档 / 测试 fixture 全需同步(migrate-before-delete)。

## Branch 3: Edge Cases & Failure Modes

**Status**: 🟢 Done

### Q3.1: K4 — content[].text 双份发送是否收敛为单行摘要?

**Answer**: **做 K4**。4 个工具的 `content[].text` 从"完整 response 的 JSON.stringify 抄本"收敛为单行摘要;`structuredContent` 原样保留(AI 真正消费的那份零变更)。
**Evidence**: 4 工具各 1 处 JSON.stringify(recall.ts:88 / archive-scan.ts:43 / extract-knowledge.ts:60 / review.ts:66)把 structuredContent 又塞进 text → 本 session fab_recall 实测 19062B 超 16384B payload warning 即此 double-payload 撑大。两端(CC/Codex)均读 structuredContent。
**Decision**: **locked**
**Constraint**: 每个工具 MUST 保留 `structuredContent` 原始形状;`content[].text` MUST 退化为单行人类摘要(非完整 JSON 复制);MUST NOT 因此丢任何 structuredContent 字段。
**Risk(低)**: 仅读 text、不读 structuredContent 的客户端会少看明细 —— 零用户阶段两端均读结构化数据,风险≈0。

### Q3.2: K5 — 报错带 action_hint + audience 失败给合法示例?

**Answer**: **做 K5**。硬错误回执从裸 throw 升级为带 `action_hint` 的结构化形态;`audience`(SCOPE_COORDINATE_PATTERN)校验失败时给合法示例(如 `project:fabric-v2`)。
**Evidence**: 4 handler 现裸 re-throw 无 envelope;audience 失败给 zod 通用 regex 消息(无示例);但 fab_recall 的 warnings[] 已有 action_hint 先例(payload-warning.ts)→ K5 是把已有 action_hint 模式从 warning 推广到 error,顺势低成本。
**Decision**: **locked**
**Constraint**: 工具错误回执 SHOULD 带 `action_hint`(可纠错指引);audience/scope 正则失败 MUST 给一个合法示例字符串;沿用 payload-warning 的 action_hint 既有模式,MUST NOT 另造一套词汇。

## Branch 4: Integration & Dependencies

**Status**: 🟢 Done

### Q4.1: K6 — 省略/丢弃裸数字升级为带原因结构化列表 + 各工具统一词汇?

**Answer**: **做 K6 + 统一词汇**。fab_recall 的 `omitted_candidate_count`(裸 number)升级为 archive_scan 同款 `dropped[]{id,reason-enum}`;reject / idempotent-skip 也给结构化 reason。所有工具的"省略/丢弃/出错"收敛到同一套结构化 reason 词汇。
**Evidence**: archive_scan 已有 `dropped[]{session_id,reason}`(范本存在,零发明);recall 现仅裸 omitted_candidate_count;K5 的 action_hint + K6 的 reason 共用一套词汇即"统一"。
**Decision**: **locked**
**Constraint**: 截断/丢弃/跳过 MUST 用结构化 `{id, reason}`(reason 取受控枚举),复用 archive_scan 的 dropped[] 形态;MUST NOT 各工具各造 reason 词汇。

### Q4.2: 新增 fab_pending 的跨端同步范围?(derived,migrate-before-delete)

**Answer**: 新工具 `fab_pending` + fab_review 收敛 + 各 shape 变更必须在**同一 PR 内原子迁移**所有引用点。
**Evidence**: Explore 实测引用面 — fabric-review / fabric-import / fabric-connect skill;`lib/shared-policy.md`(4 工具名 protected token);各 skill `ref/*.md`;server 测试 fixture(review.test.ts / mcp-server.test.ts 等)。
**Decision**: **locked**
**Constraint**: 改工具名/动作/形状 MUST 同步:① 调用方 skill SKILL.md + allowed-tools ② shared-policy.md ③ ref/*.md ④ 测试 fixture;并纳入 retired-reference lint(若工具名进 registry)。

## Branch 5: Migration & Rollback

**Status**: 🟢 Done

### Q5.1: W3-K 落地节奏 — 一个 PR vs 分两批?

**Answer**: **分两批**。批一(W3-K-a):K4 + K5 + K6 —— 零结构风险的工具输出形状小改(稳赢)。批二(W3-K-b):K2 —— 拆 `fab_pending` + 迁 fabric-review/fabric-import skill(跨端契约,单独仔细验)。出错不互连累。
**Evidence**: K2 是新工具名跨端契约变更(blast radius 大,Branch 4);K4/K5/K6 仅工具内部 shape 微调(structuredContent 不变)。符合"每批收口即 commit"工程偏好。
**Decision**: **locked**
**Constraint**: 批一 MUST 不改任何工具名/动作名(仅 content[].text + error + dropped 形态);批二 MUST 在同 PR 内原子完成 fab_pending 新增 + 全调用点迁移 + 旧 list/search action 移除。

### Q5.2: shape/schema 变更的验证门?(derived,工程纪律)

**Answer**: K4/K5/K6 改 `api-contracts.ts` 的 zod schema 后 **MUST rebuild shared dist**(`pnpm --filter @fenglimg/fabric-shared build`)否则 runtime 校验漂移;推前本地 `pnpm -r exec tsc --noEmit` + 相关 server vitest(recall/review/archive-scan/extract-knowledge test);工具名进 protected-token 清单需过 lint-protected-tokens;`LEFTHOOK=0 git commit`。
**Evidence**: 既往 lesson — 改 shared schema 不 rebuild → invalid_union_discriminator;local tsup --dts ≠ CI tsc --noEmit(rc.21/24/29 复发);shared-policy.md 列工具名为 protected token。
**Decision**: **locked**
**Constraint**: 改 api-contracts.ts schema 后 MUST rebuild shared dist 并本地 tsc --noEmit 全绿再推;新工具名 MUST 同步 protected-token 清单。
**Rollback**: 零用户 / clean-slate → 回滚靠 git revert 单 PR,不留兼容垫片。

---

## Synthesis

### Decision Summary

| # | Decision | Status | Branch | Batch | RFC 2119 |
|---|----------|--------|--------|-------|----------|
| K1 | modify 三件套 → 单自动路由 | **superseded(不做)** | 1 | — | MUST NOT 退回隐式 layer-flip 自动路由 |
| K2 | 抽只读 `fab_pending`(list/search) | **do** | 2 | 批二 | 读路径 MUST 独立工具 + readOnlyHint:true |
| K3 | archive_scan 并入 propose | **dropped(矛盾)** | 2 | — | MUST NOT 把只读并入写工具 |
| K4 | content[].text → 单行摘要 | **do** | 3 | 批一 | content[].text MUST 退化为单行摘要,structuredContent 不变 |
| K5 | error action_hint + audience 示例 | **do** | 3 | 批一 | 错误 SHOULD 带 action_hint;正则失败 MUST 给合法示例 |
| K6 | omitted→dropped[]{id,reason} + 统一词汇 | **do** | 4 | 批一 | 截断/丢弃/跳过 MUST 用结构化 {id,reason},复用 archive_scan 形态 |

**净结果**:6 候选 → **4 做(K2/K4/K5/K6)+ 2 弃(K1 superseded / K3 矛盾)**。分两批:**批一 K4+K5+K6**(零结构风险 shape 小改)→ **批二 K2**(fab_pending 拆分 + skill 迁移)。

### Verified Constraints(locked,带 code 证据)

1. fab_review MUST 保留 modify-content/modify-layer 显式分离(review.ts:915,防误翻 layer)。
2. 读路径(list/search)MUST 抽成只读 `fab_pending`(readOnlyHint:true),复用原 filters 形状零行为变更。
3. archive_scan MUST 保持独立只读,MUST NOT 并入写工具 propose。
4. 4 工具 content[].text MUST 退化为单行摘要(消 recall.ts:88 等 double-payload),structuredContent 原样。
5. 错误回执 SHOULD 带 action_hint;audience 正则失败 MUST 给合法示例;沿用 payload-warning.ts 既有 action_hint 模式。
6. 截断/丢弃/跳过 MUST 用统一结构化 {id,reason}(复用 archive_scan dropped[] 形态)。
7. 任何工具名/形状变更 MUST 同 PR 原子迁移 skill + shared-policy.md + ref + 测试 fixture;改 schema MUST rebuild shared dist + 本地 tsc 全绿。

### Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | K2 新工具名 `fab_pending` 跨端契约迁移漏点 | 4 | Medium | 原子 PR + migrate-before-delete(skill/policy/ref/fixture)+ retired-reference lint;批二单独验 |
| R2 | K4 text→summary 破坏仅读 text 的客户端 | 3 | Low | 零用户;CC/Codex 两端均读 structuredContent |
| R3 | 改 api-contracts.ts schema 不 rebuild dist → runtime 校验漂移 | 5 | Medium | rebuild shared dist + 本地 tsc --noEmit + server vitest 门 |
| R4 | census 字面过时(K4 数字错 / K1 反转 / K6 形态已存在) | 1 | (已缓解) | 本 grill 已 grounded 复核全 6 候选,别再信 census 字面 |

### Recommended Next Step

批一(K4/K5/K6)结构清晰、零产品歧义 → 可直接 `maestro-plan` + TDD 单 PR。批二(K2)涉新工具名跨端迁移 → 单独 plan + 严验(migrate-before-delete)。无需 brainstorm(scope 已锁)。

