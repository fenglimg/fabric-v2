# 06 — 架构侧审计:维护者面对的内部交互结构

> 视角:Fabric **维护者**(构建/维护这套系统的人),审内部各层(CLI engine / hooks .cjs / MCP server / shared schema / skills)之间的职责切分、数据流、派生状态、镜像漂移。
> 基调:零用户、无兼容包袱,授权激进结构重构。每个论断 grounded 到 `file:line` 或文件清单 + find/diff/md5 实测。

---

## 0. 当前内部交互结构图(文字版)

```
                       ┌─────────────────────────────────────────────┐
   真源 (authored)     │  packages/shared/src/  (Zod schema + 模板)    │
                       │   ├ schemas/fabric-config.ts   (~45 旋钮)     │
                       │   ├ schemas/api-contracts.ts                  │
                       │   ├ schemas/event-ledger.ts / events.ts       │
                       │   └ templates/bootstrap-canonical.ts (文案真源)│
                       └──────────────┬──────────────────────────────┘
                                      │ tsup build → dist/  (★ rebuild 依赖链)
                  ┌───────────────────┼────────────────────────────┐
                  │                   │                            │
        ┌─────────▼────────┐  ┌───────▼─────────┐                  │
        │ packages/cli      │  │ packages/server  │                  │
        │ (install/sync/    │  │ (MCP tools +     │                  │
        │  doctor/context)  │  │  services)       │                  │
        │                   │  │  doctor.ts 3364行 │                  │
        │ install 时拷贝 ↓   │  │  49 个 Check      │                  │
        └─────────┬─────────┘  └───────┬──────────┘                  │
                  │ 拷贝真源            │ import dist (68 文件)         │
                  ▼                                                  │
   packages/cli/templates/  ← ★镜像真源 (hooks/*.cjs + skills/*/SKILL.md)
                  │ install 拷到两端
       ┌──────────┴──────────┐
       ▼                     ▼
   <repo>/.claude/      <repo>/.codex/      ← 用户仓 (运行时被 client 加载)
   hooks/*.cjs          hooks/*.cjs
   skills/*/SKILL.md    skills/*/SKILL.md

   ★ 本仓 dogfood 自装 → 顶层 .claude/.codex + packages/cli/.claude/.codex
     共 5 份 .cjs 副本、5 份 SKILL.md 副本全部 git 跟踪

   运行时数据流 (.fabric/ 派生状态):
     hooks .cjs ──append──▶ events.jsonl ◀──append── server tools (双写入者!)
     hooks .cjs ──append──▶ injections.jsonl
     server/cli ──append──▶ metrics.jsonl
     cli scanner ──write──▶ forensic.json
     cli install ──write──▶ bindings-snapshot (resolved-bindings)
     hooks 读 ↑ via bindings-snapshot-reader.cjs (CLI 写 / hook 读)
```

**一句话**:真源在 `shared`(schema+文案)和 `cli/templates`(hook+skill 镜像源)两处;`server` 经 `dist/` 消费 schema;hook 是独立 `.cjs`,既 spawn CLI 拿数据又**本地重渲染**;`.fabric/*.jsonl` 是 cjs 与 TS 双方追加的共享 append-only ledger。

---

## 1. 镜像漂移(关键)— 实测结论

### 现状(实证)

每个 hook(`.cjs`)和 skill(`SKILL.md`)在本仓有 **5 份副本**,全部被 git 跟踪(`git ls-files` 确认):

| 副本根 | 性质 | 文件数(hooks) |
| --- | --- | --- |
| `packages/cli/templates/hooks/` | **镜像真源**(install 从这拷) | 18 |
| `.claude/hooks/` | dogfood 自装产物 | 16 |
| `.codex/hooks/` | dogfood 自装产物 | 17 |
| `packages/cli/.claude/hooks/` | dogfood 自装产物 | 17 |
| `packages/cli/.codex/hooks/` | dogfood 自装产物 | 17 |

真源 = `packages/cli/templates/`,由 `skills-and-hooks.ts` + `hooks-orchestrator.ts` 在 install 时拷到 `.claude/` + `.codex`(`hooks-orchestrator.ts:60-67`)。

**内容层面**:刚跑过 install-sync(commit `b6c3066`),抽样 md5 当前一致 ——
`fabric-hint.cjs` / `knowledge-hint-broad.cjs` / `post-tooluse-mutation.cjs` / `lib/state-store.cjs` 五份 md5 全相同;`fabric-archive` / `fabric-review` SKILL.md 五份 md5 全相同。

**但集合层面已实测漂移**(`find` 计数 + 文件名比对):

- `archive-hint.cjs` —— **只在 `.codex/hooks/`(1/5)**,其余 4 份没有。
- `summary-fallback.cjs` —— **只在 `packages/cli/.claude` + `packages/cli/.codex`(2/5)**,真源 templates 和顶层两端都缺。
- `cite-contract-reminder.cjs` —— 在 **4/5**,唯独真源 `templates/` 缺(`diff .claude/hooks/lib templates/hooks/lib` 显示 `< cite-contract-reminder.cjs`)。
- 文件数本身就不齐:16/17/17/17/18,五份没有一份相同。

> 即:**内容靠"刚同步过"维持一致,集合早已漂移**。md5 一致是 commit `b6c3066` 这次手动 install-sync 的瞬时快照,不是结构保证。`cite-contract-reminder.cjs` 出现在 4 个副本却不在真源,说明它要么是真源删除后副本未清,要么是副本侧手改未回流——无论哪种,都是真源与派生不一致的硬证据。doctor 还专门有 `createHooksContentDriftCheck` / `createL2ManagedBlockDriftCheck`(`doctor-bootstrap-lints.ts:195`)兜底漂移,反证漂移是被预期会发生的常态威胁。

### 问题(维护成本)

1. **改一个 hook 文案/逻辑,真源改 1 处,但 git 里多出 4 份 diff 噪声**,且需要重跑 install-sync 才能让 dogfood 副本跟上;忘了跑 → 漂移。
2. **5 份全进版本控制**,PR review 时一个改动放大成 5x diff,reviewer 无法分辨"真改动"和"机械同步"。
3. **集合漂移无人守**:doctor 守的是"已 wired 的 hook 内容漂移",不守"templates 缺了某个 lib 而某副本多出来"——`cite-contract-reminder.cjs` / `summary-fallback.cjs` 的集合不一致没有 lint 抓。
4. **横向对照**:`maestro-flow` 也是 `.claude`(45)+`.codex`(74)双镜像,但**没有 `templates/` + `packages/*/.claude` 这第三、四、五层**。Fabric 比作者自己的更大项目多叠了 2 层镜像,纯粹因为"dogfood 自己装自己"把产物也 commit 了。

### 方案(激进,grounded)

- **【P0 立即】把 dogfood 自装产物移出版本控制**:`.claude/hooks`、`.codex/hooks`、`packages/cli/.claude`、`packages/cli/.codex` 这 4 套是 `fabric install` 在本仓的输出,应 `.gitignore`,只保留 `packages/cli/templates/` 这唯一真源进 git。**5 份 → 1 份**。代价:近乎零(它们本就是可由 install 重新生成的派生物);收益:git diff 噪声 5x→1x,集合漂移不可能再发生(产物不入库)。
- **【P1】构建时生成 templates,而非手维护**:hook 的 `lib/*.cjs` 若与 shared 有逻辑重叠(见 §3),应从 TS 真源 bundle 出 cjs(esbuild/tsup `--format=cjs`),`templates/hooks/` 变成 `dist` 产物而非手写源。代价:中(要搭 hook 的构建管线);收益:消除 cjs/TS 双实现。
- **保留** `packages/cli/templates/` 作为 install 拷贝源是合理的(install 需要一份可直接 copy 的物料)。

**价值÷成本**:P0 价值极高(直接砍掉 80% 镜像副本 + 根治集合漂移)/ 成本极低(改 `.gitignore` + `git rm --cached`)= **最高优先级**。

---

## 2. 派生状态流

### 现状(实证)

`.fabric/` 下派生状态文件(本仓实测):

| 文件 | 大小 | 写入者 | 读取者 | schema 真源 |
| --- | --- | --- | --- | --- |
| `events.jsonl` | 419 KB | **hooks .cjs(6+)+ server tools(2+)双写** | doctor / recall / archive | `shared/schemas/event-ledger.ts` |
| `injections.jsonl` | 31 KB | hooks `injection-log.cjs` | doctor / context | — |
| `metrics.jsonl` | 27 KB | server services + cli | `fabric metrics` | `shared` |
| `forensic.json` | 8 KB | cli scanner | doctor | — |
| bindings-snapshot | (resolved) | cli install | hooks `bindings-snapshot-reader.cjs` | `shared/schemas/bindings-snapshot.ts` |
| `agents.meta.json` | **本仓 `.fabric/` 不存在** | engine | engine | — |

实测要点:

1. **`events.jsonl` 是 cjs 与 TS 双写入者的共享 append-only ledger**:写入方含 `cite-policy-evict.cjs` / `knowledge-hint-broad.cjs` / `fabric-hint.cjs` / `post-tooluse-mutation.cjs` / `session-end-marker.cjs` / `nudge-policy.cjs`(6 个 hook),以及 `server/src/tools/archive-scan.ts` / `recall.ts` / `index.ts`。**两套语言、两套写路径,共享同一 schema(`event-ledger.ts`)但 cjs 侧不经 Zod 验证**——schema 只在 TS 侧强制,cjs 侧手拼 JSON,漂移风险全靠人。
2. **`agents.meta.json`**:AGENTS.md 反复声明"严禁手编、engine 重建",但本仓 `.fabric/` 根本没有这个文件(只在 `__tests__/fixtures` 和 `.workflow/` 历史快照里)。说明这个被大书特书的"派生状态"在 dogfood 主仓要么 gitignore、要么按需生成——**文档强调的重量 ≠ 实际存在感**。
3. **bindings-snapshot 单向清晰**:CLI install 写、hook 读(`bindings-snapshot-reader.cjs`),这条派生流是健康的(单一写者)。

### 问题

- **events.jsonl 双语言写入者 = 一致性靠人肉**:加一个事件类型,要在 `shared` 改 schema + rebuild dist(TS 侧),再在 6 个 cjs hook 里手拼对应字段(cjs 侧),漏一处就静默写出非法事件,直到 `createEventLedgerSchemaCompatCheck` 在 doctor 时才发现。
- **派生状态文件 5 种(events/injections/metrics/forensic/bindings)+ meta**,每种各自的重建/校验逻辑分散在不同 check(`createEventLedgerPartialWriteCheck` / `createForensicCheck` / `createMetaCheck` / `createCounterDesyncCheck`…)。维护者要在脑子里维护 6 张"谁写谁读何时重建"的表。

### 方案

- **【P1】cjs 事件写入收敛到单一 helper**:hook 侧所有 `events.jsonl` append 走一个共享 `lib/event-append.cjs`,该 cjs 从 shared 的 event schema **构建时生成**(把 Zod 校验逻辑 codegen 成 cjs guard),消除 6 处手拼 + 让 cjs 侧也有 schema 守门。代价:中;收益:events 一致性从"人肉"变"构建保证"。
- **【P2】injections.jsonl 可能冗余**:它记注入历史,但 events.jsonl 已记 `injection`-类事件。审一遍二者重叠度,能合则合,少一个 jsonl 少一套读写。

**价值÷成本**:P1 中高 / 中 = 值得做。

---

## 3. 层边界:CLI / server(MCP)/ shared / hooks(.cjs)的跨语言双实现

### 现状(实证)

- **注入文案真源**:`shared/templates/bootstrap-canonical.ts`(215 行,`BOOTSTRAP_CANONICAL_ZH` 等常量,`bootstrap-canonical.ts:33-57`)。
- **hook 注入实现**:`knowledge-hint-broad.cjs` **1336 行独立 cjs**。它 `spawnSync` 调 `fabric plan-context-hint --all` 拿数据(`knowledge-hint-broad.cjs:468`),**但渲染(`renderFull` / `renderTruncated` / `renderSummary` / `renderBanner`)在 hook 本地重新实现**(`582-707` 行)。
- **"字节一致"方向**:注释说 `fabric context` 命令复用 hook 的 render 实现 → 二者 byte-identical(`knowledge-hint-broad.cjs:1025,1193`;`context.ts:21,132`)。即**真源是 hook 的 cjs render,CLI `context` 命令反向复用它**——这跟直觉相反(本以为 hook 复用 CLI)。

### 问题

- **跨语言双实现的认知倒置**:渲染逻辑的真源在 `.cjs` hook 而非 TS,导致 `fabric context` 这个 TS 命令要 require 一个 cjs 才能做到字节一致。层边界被语言切割得很别扭:数据层(plan-context-hint)在 TS、渲染层在 cjs、消费渲染的命令又在 TS。
- **为什么用 cjs**:client(Claude Code / Codex)的 hook 机制要求独立可执行脚本、不能依赖 TS build / node_modules 解析,所以 hook 必须是自包含 cjs。这是真实约束,不是随意选择。但代价是 hook 想复用任何 TS 逻辑都得要么 spawn CLI、要么把逻辑搬进 cjs。
- **1336 行 cjs 单文件** + `lib/` 下 14 个 cjs(`banner-i18n` / `nudge-policy` / `cite-line-parser` / `config-cache` / `state-store`…)——这是一套**与 TS 主代码平行的第二套运行时**,有自己的 config 解析(`config-cache.cjs`)、状态存储(`state-store.cjs`)、i18n(`banner-i18n.cjs`)。

### 方案

- **【P1】渲染逻辑真源归 TS,cjs 由构建产出**:把 render 逻辑写在 `shared`(纯函数、无 fs),用 esbuild bundle 成单文件 cjs 注入 `templates/hooks/`。`fabric context` 命令直接 import TS 版,hook 用 bundle 版——**同一真源,两个产物**,字节一致由"同源编译"保证而非"反向 require cjs"。代价:中高(搭 hook bundle 管线);收益:消灭第二套手写运行时,层边界回正(TS 是唯一逻辑层,cjs 是编译产物)。
- **替代(更激进)**:hook 退化为极薄 shim,所有逻辑走 `spawnSync fabric <subcommand>`,渲染也由 CLI 出(hook 只负责把 CLI stdout 转交 client)。代价:每次 hook 触发多一次进程启动(spawn 已有,只是范围扩大);收益:cjs 几乎清空,单一真源。需测 spawn 延迟对 SessionStart 体感的影响。

**价值÷成本**:P1 高价值(消除整套平行运行时是维护负担的最大单一来源之一)/ 中高成本。

---

## 4. doctor lint 膨胀

### 现状(实证)

- AGENTS.md 自述"背 35 条 doctor lint 代码"(`.fabric/AGENTS.md:22`)。
- **实测 `doctor.ts` 3364 行,注册 49 个 `createXxxCheck`**(grep 去重计数)。lint 逻辑分散在 6 个文件:`doctor-bootstrap-lints.ts`(243)、`doctor-hooks-lints.ts`(405)、`doctor-skill-lints.ts`(430)、`doctor-scope-lint.ts`(225)、`conflict-lint.ts`(210)、`shared/store/cross-store-lint.ts`。
- `services/` 目录 **95 个 ts 文件**。

49 个 check 抽样(语义分类):
- 派生状态一致性:`EventLedger*`(4 个)、`CounterDesync`、`MetaManuallyDiverged`、`PromoteLedgerInvariant`、`Forensic`、`StoreCounter`…
- 镜像/漂移:`HooksContentDrift`、`L2ManagedBlockDrift`、`BroadIndexDrift`、`IndexDrift`、`RelevancePathsDrift`、`SkillRefMirror`、`LegacyClientPath`…
- 知识卫生:`KnowledgeSummaryOpaque`、`KnowledgeTagsEmpty`、`KnowledgeDirUnindexed`、`OrphanDemote`、`StaleArchive`、`Underseeded`…
- 文案/router:`RouterChainRef`、`RuleContentRef`、`RuleSections`、`SkillDescription`、`SkillTokenBudget`…

### 问题

- **lint 数量 ≈ 派生状态/镜像复杂度的镜像**:`EventLedger` 占 4 个 check、一堆 `*Drift` check —— 这些 lint **不是独立价值,而是 §1 镜像 + §2 派生状态复杂度的"补偿性税"**。每多一层镜像/一种派生状态,就多 1-N 个 check 兜底。
- **加一条 lint 的成本**:新逻辑写在 6 个 lint 文件之一 → 在 `doctor.ts` 注册 `createXxxCheck` → 接 i18n translator(`createXxxCheck(t, inspection)` 签名)→ 写 test → 可能还要在 AGENTS.md 更新"N 条"叙述。**牵连 3-5 处**。
- **lint 与 bootstrap 文案耦合**:`L2ManagedBlockDrift` 直接比对 `BOOTSTRAP_REGEX` 与 `bootstrap-canonical.ts`(`doctor-bootstrap-lints.ts:153`),文案一改,lint 的 expected 自动跟(这点是好的);但 `RouterChainRef` / `RuleContentRef` / `SkillDescription` 这类 lint 把 skill/router 文案的结构约束硬编码进 lint,文案重构会撞 lint。

### 方案

- **【P1】lint 数量随结构简化自然下降**:做完 §1(砍镜像)→ 所有 `*Drift` / `SkillRefMirror` / `LegacyClientPath` 类 check 可删(产物不入库就无漂移可查)。做完 §2(events 收敛)→ `EventLedger*` 4 个 check 可合并。**预估 49 → ~30**。lint 膨胀的根治不在删 lint,而在删它们守护的复杂度。
- **【P2】lint 注册表驱动**:49 个 `createXxxCheck` 手动注册改成数组/注册表 + 元数据(code/severity/category/i18n-key),`doctor.ts` 遍历执行。加 lint = 加一个数组项,不碰 3364 行的 orchestration。代价:中(一次性重构注册机制);收益:加 lint 从"碰 3-5 处"变"加 1 项"。

**价值÷成本**:P1 跟着 §1/§2 走(零额外成本)/ P2 中。

---

## 5. config 旋钮膨胀(架构角度)

### 现状(实证)

- `.fabric/fabric-config.json` 实测 **~45 个字段**(含 9 个路由/store 字段 + ~36 个行为旋钮:`archive_hint_cooldown_hours`、`hint_broad_top_k`、`embed_weight`、`cite_recall_window_minutes`…)。
- **两套解析**:TS 侧 `shared/schemas/fabric-config.ts`(Zod)+ `server/src/config-loader.ts`;hook 侧 `templates/hooks/lib/config-cache.cjs`(独立读 + parse 同一 JSON)。`config-cache.cjs` 注释自述它合并了"five per-key readFileSync+parse config readers"(`knowledge-hint-broad.cjs:57`)。

### 问题

- **CLI/server 读 Zod-validated config,hook 读裸 JSON**:`config-cache.cjs` 不经 Zod,默认值/类型若与 `fabric-config.ts` 不同步,hook 与 CLI 对同一旋钮的解读可能不一致。加一个旋钮:改 `fabric-config.ts`(schema + 默认值)→ rebuild dist → 在 `config-cache.cjs` 手加读取 + 手填默认值 → 可能再加 doctor lint 校验。**牵连 3-4 处跨语言**。
- **36 个行为旋钮**多数是 hint cooldown / top-k / threshold 这类微调,绝大部分用户永不改。属于"暴露过多内部参数",是配置面而非架构面问题(留给 config 审计员细究),架构角度的问题是**双解析**。

### 方案

- **【P1】config 默认值与类型 codegen 到 cjs**:从 `fabric-config.ts` 的 Zod schema 生成一份 `config-defaults.cjs`(默认值 + 字段名常量),`config-cache.cjs` import 它,消除手填默认值的漂移点。代价:低-中;收益:旋钮真源唯一,hook/CLI 解读保证一致。

**价值÷成本**:P1 中 / 低-中。

---

## 6. schema 真源与 rebuild 依赖链脆弱性

### 现状(实证)

- schema 真源全在 `packages/shared/src/schemas/`(`api-contracts.ts` / `event-ledger.ts` / `bindings-snapshot.ts` / `fabric-config.ts`)。
- `shared/package.json` 的 `exports` 全部指向 `./dist/*`(`main: ./dist/index.js`,`api-contracts.ts:27-43`)。
- **server 68 个文件 import `@fenglimg/fabric-shared`**,全部消费 `dist/`,不是 `src/`。
- 已知 gotcha(MEMORY):改 shared schema 不 rebuild dist → server 运行时 `invalid_union_discriminator`;rc.21/24/29 三次复发 local `tsup --dts` ≠ CI `tsc --noEmit`。

### 问题

- **改一行 zod schema → 必须 `pnpm --filter @fenglimg/fabric-shared build` 才生效**,否则 server 仍跑旧 dist。这是 monorepo 用 `dist` 而非 `src` 跨包引用的经典脆弱性:**编辑面(src)与消费面(dist)之间隔着一次手动 build**,忘了就静默跑旧码。
- 68 个 import 点全依赖这条链,单点(忘 rebuild)失效面极大。

### 方案

- **【P1】开发态走 src,发布态走 dist**:`shared/package.json` 加 `exports` 的 `development` condition 或用 tsconfig `paths` 让 server 在 dev/test 直接解析 `shared/src/*.ts`(vitest + tsx 原生支持),**消除 dev 阶段的 rebuild 步骤**;只有 `pnpm pack`/发布才需 dist。代价:中(配 conditions/paths + 验证 CI);收益:根治 rc.21/24/29 复发的整类 bug。
- **替代**:build watch 常驻(`pnpm -r dev` 已有),但靠人记得开 watch 仍脆;`exports.development` 是结构性根治。

**价值÷成本**:P1 高(根治一类复发 release bug)/ 中。

---

## 架构 Top 5 重构项(按"减少维护者认知负担/牵连面"排序)

| # | 重构项 | 牵连面现状 | 重构后 | 价值÷成本 |
| --- | --- | --- | --- | --- |
| **1** | **dogfood 自装产物移出 git**(§1):`.gitignore` 掉 `.claude/.codex` + `packages/cli/.claude/.codex`,只留 `templates/` 真源 | 改 1 文案 → 5 份 diff + 集合漂移(`archive-hint`/`summary-fallback`/`cite-contract-reminder` 已实测不齐) | 1 份真源,集合漂移不可能再发生 | **极高 / 极低** |
| **2** | **shared 开发态走 src 不走 dist**(§6):`exports.development` condition | 改 1 行 schema → 手动 rebuild dist,忘则 server 跑旧码(rc.21/24/29 三复发) | dev 零 rebuild,根治整类 release bug | **高 / 中** |
| **3** | **hook 渲染逻辑真源归 TS、cjs 由构建产出**(§3):消灭 1336 行 cjs + 14 个 lib cjs 的平行运行时 | render 真源在 cjs,CLI 反向 require cjs;改逻辑改两套 | 单一 TS 真源,cjs 是编译产物,字节一致由同源保证 | **高 / 中高** |
| **4** | **events.jsonl 写入收敛 + cjs schema guard codegen**(§2):6 hook 手拼 → 单一生成的 append helper | cjs 侧无 schema 校验,加事件类型改 7+ 处跨语言 | 一致性从人肉变构建保证 | **中高 / 中** |
| **5** | **doctor lint 注册表化 + 随 §1/§3 自然瘦身**(§4):49 check → ~30,加 lint 从碰 3-5 处变加 1 项 | 49 个手动 `createXxxCheck` 注册在 3364 行 doctor.ts;过半是镜像/派生状态的补偿税 | lint 数随结构简化下降,新增成本骤降 | **中 / 中**(#1#3 做完大半自动达成) |

**核心洞察**:Top 1/3/4/5 是同一根因的不同切面——**"把派生物当真源进版本控制"(镜像)+ "用第二套 cjs 平行实现 TS 逻辑"(hook)**,二者制造了大量补偿性 lint(§4)和一致性人肉义务(§2)。先做 #1(几乎零成本砍 80% 镜像),再做 #3(消灭平行运行时),则 §4 一半 lint 自动消失。#2 是独立的 monorepo 卫生问题,但因复发三次、价值÷成本最优,建议与 #1 并列先做。
