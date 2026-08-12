# Research: 工程清晰度审计 — shared / server-http-experimental / 仓库级杂项

- **Query**: packages/shared + packages/server-http-experimental + 仓库级累积物的精简去繁诊断(只诊断不修复)
- **Scope**: internal(全部基于本仓库实测)
- **Date**: 2026-08-10
- **方法**: 所有 correctness-critical 普查用 node 脚本(fs walk + includes / regex),未用本机 Bash grep(ugrep 假阴性)。数字为 2026-08-10 main@95a0491a 快照。
- **审计口径声明**: 首轮 import-census 有两类系统性漏报,已用第二轮 verify pass 修正:① `export { x } from "pkg"` re-export 不匹配 import 正则(serve-lock 案例);② `dt(\`...\`)` 等非 `t()` 动态 key 构造(cite-coverage 案例)。以下结论均为修正后。

---

## 1. server-http-experimental 处置证据

### 现状证据

**包本体**: 27 个 tracked 文件(24 个 .ts = src 14 文件/1,804 行 + 测试 10 文件/1,899 行,另 README.md / package.json / tsconfig.json),`packages/server-http-experimental/`。

**隔离是彻底的(五层证据)**:

| 层 | 证据 | 路径 |
|---|---|---|
| workspace | `- "!packages/server-http-experimental"` 显式排除,`pnpm -r` 全跳过 | `pnpm-workspace.yaml:6` |
| lockfile | pnpm-lock.yaml 中 **0 处**该包条目(install 图之外,node_modules 仅 4K 空壳) | `pnpm-lock.yaml` |
| 依赖/import | 主线三包 **0 个** workspace 依赖、**0 个** import specifier、**0 个** pnpm --filter 引用 | 全仓 node 扫描 |
| CI | ci.yml / reusable-validate.yml / release.yml **0 处**提及 | `.github/workflows/*` |
| 反向 gate | 专职 census 测试强制以上所有边界(113 行) | `packages/server/src/handler-project-context-census.test.ts:58-112` |

**主 checkout 全部 46 处提及的构成**(排除 worktrees/.workflow/.trellis 后):约 15 处 `.fabric/` 遥测日志(events.jsonl/edit-counter/forensic.json)、8 处文档叙述(CHANGELOG.md:77,114 / README.md:246 / docs/ARCHITECTURE.md:13 / RUNTIME-CONTRACTS.md:35 / TESTING.md:80 / USER-QUICKSTART.md:188 / packages/cli/README.md:33)、约 13 处代码注释(packages/server/src/index.ts:4,202,212,246,564 等)、8 处 census 测试断言、2 处 pnpm-workspace.yaml。**没有一处是运行时引用。**

**代码已烂(rot 证据)**: `packages/server-http-experimental/src/http.ts:23` `import { invalidateKnowledgeSyncCooldown } from "@fenglimg/fabric-server"` — 该符号在 `packages/server/src/index.ts` 中已不存在(全仓搜索 12 hits 全部在 exp 包内部)。包内 `typecheck` 脚本存在但因 workspace 排除从未被 `pnpm -r exec tsc` 执行 → **无声腐烂,"保留待复活"的前提(能编译)已不成立**。README 声称的 restoration recipe 实际等价于"从 git 历史重写"。

**它拖住的尸体(耦合成本)**: 它是以下 shared 资产的唯一消费者 —— `packages/shared/src/schemas/events.ts`(12 exports,见 §2)、api-contracts.ts §"Existing API contract schemas"(ledgerQuerySchema/historyStateQuerySchema,`api-contracts.ts:1776-1823`)、以及 i18n 里 201 个 `dashboard.*` key ×2 locale(见 §3)。这些在主线全是死码,但"quarantine 而非 delete"让每次清理判断都要重新论证一遍。

**版本仍被 release 链路触碰**: 其 `version: "2.5.0-rc.4"` 与主线同步(历史 issue ISS-20260608-052 记录 apply-tag-version 会改写 quarantined 包版本)。

### 精简提案

**删除进 git 历史**(整目录 rm + 去掉 pnpm-workspace.yaml:6 排除行 + 改写 census 测试的 109-111 行断言与 filesBelow 跳过项 + 清 8 处文档叙述改为"已删除,历史见 tag X")。同批可连带删除它独占的 shared 尸体(events.ts、api-contracts §10、dashboard.* i18n keys),收益翻倍。

### 风险

- **决策治理**: KT-DEC-0016(quarantine-not-delete,留 web-UI 门)需走 KB supersede 流程;仓库记忆已两次实证该决策的 web-UI-door rationale 被质疑陈旧(且现有 `fabric preview` 命令已提供另一条 UI 路径)。
- **技术风险极低**: 零运行时耦合已被 census 测试连续验证;恢复 = `git checkout <last-tag> -- packages/server-http-experimental`。
- 需同步动 3 个文件(workspace yaml、census test、docs),漏改 census test 会 CI 红 —— 这是自愈型风险(测试会指出来)。

### 优先级: **P1**(自身零运行时负担,但它是 §2/§3 三块尸体的"锁"——先删它,后续清理才无争议;建议排在 i18n 清理之前)

---

## 2. shared 包边界

### 2a. api-contracts.ts 单文件解剖

`packages/shared/src/schemas/api-contracts.ts` = **1,917 行 / 68 个 z.object / 33 个 z.enum / 4 个 discriminatedUnion / 47 export const + 18 export type + 2 export function**,被 cli+server 共 21 个文件 import。内部已用 banner 注释分成 **11 个 section**(天然拆分缝):

| Section(行号) | 行数 | 内容 | 实测消费方 |
|---|---|---|---|
| 7-18 shared warning | 12 | structuredWarningSchema | server 4 文件 |
| 19-292 MCP plan-context | 274 | planContext I/O | 仅 shared 测试(CLI `plan-context-hint` 命令与 hooks 走运行时 spawn,不 import 此 schema) |
| 293-329 CLI plan-context-hint | 37 | hint 输出 | planContextHintOutputSchema **全仓仅定义处 1 hit**(contract-doc-only) |
| 330-441 knowledge-sections | 112 | sections I/O | 仅 shared 测试(server 5 个生产 handler 中无此工具) |
| 442-695 fab_recall | 254 | recall I/O | server(recallInputSchema 2 / recallOutputSchema 3 文件) |
| 696-986 fab_propose | 291 | extract-knowledge I/O | server 3 文件 |
| 987-1164 fab_review | 178 | review I/O | server 4 文件 |
| 1165-1590 fab_pending | 426 | pending browse/search | server 4 文件 |
| 1591-1771 doctor --cite-coverage | 181 | cite coverage 报告 | server 1 + shared 3(cli 走 dt() 渲染) |
| **1772-1840 "Existing API contract schemas"** | 69 | ledger/history/humanLock/annotateIntent 查询 | **HTTP 时代遗留**: ledgerQuery/historyStateQuery 唯一非测试消费者 = exp 包;humanLockApprove/humanLockFileParams/annotateIntent **仅 shared 自己的 roundtrip 测试引用**(各 4-10 hits 全在 test) |
| 1841-1917 v2.0 Knowledge entry | 77 | 5-type/maturity/StableId | KnowledgeTypeSchema live(server 1+shared 4);**KnowledgeEntryFrontmatterSchema 全仓 0 消费者**(仅定义处 2 hits;runtime 用的是 knowledge-meta-builder.ts:748-785 手写 regex parser,文件内注释自己承认) |

**拆分缝结论**: 5 个 MCP 工具契约(recall/propose/review/pending + warning)占 ~1,000 行且全部是 server 单向消费;§10(69 行)+ KnowledgeEntryFrontmatterSchema(~45 行)是可直接删除的死区;plan-context/knowledge-sections 两段(~423 行)是"退役 MCP 工具的契约"仅测试在养。

### 2b. 伪共享普查(全量,非抽样 — 覆盖 shared/src 全部 69 个非 barrel 模块)

方法: 解析每模块 export 符号 → 扫 cli/src、server/src、exp 的 `@fenglimg/fabric-shared*` named import → verify pass 修正 re-export/构建期消费。

**双端真共享(cli+server): 24 个模块** — api-contracts、store.ts(23 文件引用)、atomic-write(19)、global-config-io(17)、i18n/types(32)、store/core(13)、store-resolver(13)、detector、forensic-report、scope、templates/bootstrap-canonical 等。共享定位成立。

**单端消费(伪共享候选,26 个)**:

| 仅 cli 用(12) | 备注 |
|---|---|
| `theme.ts`(13 exports, 2 文件) | 纯 CLI 呈现层,占 shared 一个 package.json subpath export |
| `scanner/scan-recommendations.ts` | 当年为消除与 exp scan.ts 的 fork 而上移;exp 隔离后只剩 cli 消费 |
| resolve-global-locale / config-profiles / fabric-config-introspect / fabric-config / bindings-snapshot / git-remote-allowlist / observability / git-worktree-identity / errors/fabric-error / (theme) | 各 1-4 文件引用 |

| 仅 server 用(14) | 备注 |
|---|---|
| `schemas/event-ledger.ts`(**132 exports**, 12 文件) | shared 里最大的单端模块 |
| `types/agents.ts`(17 文件)/ agents-meta(8)/ mcp-payload-guard(12)/ project-config-io(8)/ high-value-predicate / resolve-fabric-locale / knowledge-test-index / cross-store-lint / text-tokenize / ledger-entry / types/ledger / resolution / store-counters / store-lifecycle(后两项 cli 也有少量引用,归双端亦可) | mcp-payload-guard 有独立 subpath export |

**死/半死模块(6)**:

| 模块 | 状态 | 证据 |
|---|---|---|
| `schemas/events.ts`(12 exports) | **EXP-ONLY** | 非测试消费者仅 `exp/src/api/events.ts`;主线事件走 event-ledger.ts |
| `schemas/human-lock.ts`(3 exports) | 近死 | 非测试引用仅 events.ts(其本身 exp-only)与 i18n 字符串 |
| api-contracts §10 的 humanLock*/annotateIntent* | 死 | 仅 shared/test/integration/{schemas-roundtrip,refine-error-shape}.test.ts |
| `schemas/mcp-store-contracts.ts`(8 exports) | TEST-ONLY | 仅自身测试 + barrel |
| `schemas/provenance.ts`(2 exports) | 传递性 test-only | 仅 mcp-store-contracts(其本身 test-only)+ 1 测试 |
| `resolver/store-qualified-id.ts` 的 `resolveStoreQualifiedId` | TEST-ONLY | 全仓 5 hits: 定义 1 + `shared/test/store/p2-resolution-leak.test.ts` 4;server doctor 系列的 "qualifiedId" 命中均为 server 本地 helper |

**verify pass 澄清的"假死"(不要删)**: serve-lock.ts(server 经 `legacy-serve-lock-probe.ts` 用 `export {} from` re-export 消费)、hook-runtime-entry/project-context-resolver/project-root-resolver(被 `scripts/build-hook-project-context.mjs` + `packages/cli/tsup.hook-runtime.config.ts` 构建期打进 5,002 行 hook bundle)、protected-tokens(CI step `scripts/lint-protected-tokens.ts` 消费)、cite-line-parser(hook .cjs byte-parity twin + parity 测试)、parity-matrix(cli e2e 契约测试资产)。

**knip 为何看不见**: `packages/shared/src/index.ts` 用 40 个 `export *` barrel 全量转出,knip --strict 视 re-export 为使用;knip.config.ts:96-104 又把 shared 的 8 个入口全列 entry。死 export 因此零告警。

### 精简提案

1. 删 6 个死/半死模块(~110 行 api-contracts 死区 + events.ts/human-lock.ts/mcp-store-contracts.ts/provenance.ts 约 400 行 + 对应测试)——前置条件是 §1 exp 删除。
2. api-contracts.ts 按 11 个既有 banner 缝拆成 per-tool 文件(barrel 保持 re-export,21 个消费文件零改动);优先把 5 个 MCP 工具契约拆出(~1,330 行)。
3. 伪共享下沉(theme→cli、event-ledger→server 等)**只在顺手重构该模块时做**——shared 是已发布 npm 包,下沉即公开 API 变更,单独做性价比低。

### 风险

- shared 改 schema 必须 rebuild dist(跨包 typecheck 读 dist/*.d.ts,历史上 rc.21/24/29 三次翻车);拆文件后 tsup entry 列表(package.json build script 10 entries)需同步。
- "TEST-ONLY"分类依赖 import 扫描,dynamic import()/字符串引用理论上可漏——删除前按模块跑一次 `pnpm -r build && pnpm -r exec tsc --noEmit` 兜底。

### 优先级: 死区删除 **P1**(跟随 §1);文件拆分 **P2**;伪共享下沉 **P2**(搭车执行)

---

## 3. i18n 双语维护面

### 现状证据

- **规模**: `packages/shared/src/i18n/locales/en.ts` 1,840 行 / `zh-CN.ts` 1,790 行;**扁平 key→string map,各 1,252 个 key,零嵌套**。
- **drift 检测: 已存在且是确定性 gate** — `packages/shared/src/i18n/locale-parity.test.ts` 断言两表 key-for-key 相同 + 值非空。实测 en-only 0 / zh-only 0 / en 内重复 key 0。**双边同步不是问题。**
- **未引用 key(保守口径)**: 全仓(src+templates+hooks+scripts+md,排除 locale 自身与测试)精确字面量搜索 → 728 key 有 live 引用;再收集所有含 `${}` 的 i18n-形模板字面量前缀(47 个 `t(\`...\`)` 位点 + `dt(\`...\`)` + `label_i18n_key: \`cli.config.fields.${key}.label\`` 这类数据构造,共 176 key 被动态前缀覆盖)→ **剩 348 个 key(27.8%)无任何字面量或动态前缀可达 = 保守死键;×2 locale ≈ 700 条目、粗估 ~500 行**。
- **死键聚类**(2 段前缀直方图): `dashboard.*` **201 个**(rule-topology 26 / doctor 26 / app 23 / history-replay 19 / lock-card 17 / rules-tree 16 / intent-timeline 11 / readiness 11 / ...)—— v1.8 web Dashboard 的全部 UI 文案,主线唯一 "dashboard." 命中是一行注释(`packages/cli/src/commands/metrics.ts:1`);`doctor.check.*` 55 个(退役检查项残留;注意该前缀同时有 323 处 live 引用,死的是个别 key 不是整族);`cli.install.*` 43;`cli.doctor.*` 16;`cli.config.*` 11;`cli.shared.*` 8(如 `cli.shared.missing/present/loading`)。
- **20-key 抽样验证**(死键列表等距抽样,含 dashboard/doctor.check/cli.install 各族): 20/20 在全仓(含测试)**子串命中为 0** —— 见本文附录 A。
- **既有工具已烂**: `scripts/i18n-audit.mjs` 头注自称 "One-off ... not committed" 却已提交,按**嵌套结构** flatten(现实是扁平表)、从 dist 导入,且无任何 package.json/CI 接线(§4 orphan 清单之一);其 parity 功能已被 locale-parity.test.ts 取代,unused-key 功能从未存在。

### 精简提案

1. 删 348 死键 ×2 locale(dashboard 族 201 个与 §1 同批删,证据链最硬);
2. 把"unused-key census"固化成 shared 内测试(与 locale-parity.test.ts 同款 ratchet:允许 dynamic-prefix 白名单),防止回涨;
3. 删或重写 scripts/i18n-audit.mjs(现状是误导性尸体)。

### 风险

- 动态构造是唯一误删源: 47+ 个 `t(\`...${}\`)`/`dt(\`...\`)` 位点已被前缀白名单覆盖,但新增的字符串拼接(`"prefix." + x`)形态只覆盖了显式 `t("..." +` —— 删除 PR 应跑全量 vitest(i18n 测试会对缺 key 显示 raw key,cli NO_COLOR 快照测试会抓 UI 回归)。
- `doctor.check.*` 55 个死键建议单独一批删(该命名空间 live 密度高,review 时容易看走眼)。

### 优先级: **P1**(纯减法、有确定性 gate 兜底、~700 条目是 shared 最大单块冗余)

---

## 4. 仓库级累积物

### 现状证据

**`.workflow/` — 36M / 588 文件,git-tracked 仅 93 个**:

| 子项 | 大小 | git | 活/尸判定 |
|---|---|---|---|
| kg/(maestro.db+wal) | 15M | untracked | **活**(db-shm mtime Aug 6)— maestro 工具机器产物 |
| search-cache.json / wiki-index.json | 5.5M / 4.6M | untracked | 活(Aug 6 重建) |
| embedding.zvec(+bin/meta) | 6M | untracked | 活(Aug 5) |
| sessions/(7 个目录) | 2.4M | untracked | 尸体(最新 20260723) |
| issues/issues.jsonl | 864K | **tracked** | 活 — 173 条: **3 open / 170 closed**(open: ISS-20260806-001 archive range 语义、-002 forensic 扫描 15,071 vs 干净 922 文件、-003 测试 flaky 30/31/32) |
| blueprint/(37 tracked 文件) | 324K | tracked | 尸体(BLP-* 均 2026-06-06 时代) |
| active/(28 tracked 文件, 2 个 WFS) | 212K | tracked | **名不副实**: WFS-fabric-v2-cognitive-alignment-tdd 对应 roadmap milestone 已于 07-12 closed,仍躺 "active/" |
| scratch/(20 tracked 文件) | 188K | tracked | 尸体(4 个分析目录 + fix-literal-newlines.cjs,07-13~07-27) |
| roadmap.md | 8K | tracked | **半尸**: 唯一 milestone 标记 completed(2026-07-12),此后未更新(mtime Jul 12) |
| knowhow/(2 md) | 8K | tracked | 半活(0723) |

**`.claude/worktrees/` — 910M / 3 个嵌套 worktree(git-ignored 但物理存在)**:

| worktree | 分支 | 状态 |
|---|---|---|
| mystifying-heisenberg-7ba37c | claude/mystifying-heisenberg-7ba37c | **已完全 merge 进 main**(0 ahead)→ 纯尸体 ~300M |
| fabric-observability-fixes | worktree-fabric-observability-fixes | 未合并: 5 ahead / **12 behind**,最后提交 07-30 |
| relaxed-varahamihira-2e790f | feat/sync-readme-version | 未合并: 5 ahead / **13 behind**,最后提交 07-30 |

已知危害(仓库记忆两次实证): worktree 一旦存在,主 checkout 的 hooks-runtime-generated 测试就假红(repo 遍历把 package.json 数两遍),并在 worktree 内跑 detectClient 系测试有 21 个假失败 —— 与 open issue ISS-20260806-003(flaky 30/31/32)和 -002(forensic 15,071 文件)直接相关。

**其他仓库级**:

- `tmp/` **535M**(ignored): 实为 **10** 个 vendored 调研仓。`local_cache/` 91M(ignored)。`.fabric/` 16M(dogfood 遥测,仅 4 文件 tracked)。
  - **✅ 两者均已于 2026-08-12 删除。** 删除依据不是"占地方"而是**可逆性经过核对**:
    10 个克隆全部 `dirty=0` / 未推提交 `=0` / 有公开 remote,即本地零改动,`git clone` 可原样取回;
    `local_cache/` 是 fastembed **修复前**的 cwd 相对默认值残留,与 `~/.fabric/cache/embed/` 下
    代码实际读取的那份是同一模型的重复副本(`model_optimized.onnx` 两边均 94,781,076 字节),
    删除不触发重新下载。判据见 `vector-retrieval.ts#defaultEmbedCacheDir` 的注释。
  - 调研仓清单(想复现对照阅读时按此重新 clone):

    | 仓库 | 体积 | remote |
    |---|---|---|
    | trellis | 246M | https://github.com/mindfold-ai/trellis |
    | GitNexus | 172M | https://github.com/abhigyanpatwari/GitNexus |
    | mem0 | 53M | https://github.com/mem0ai/mem0 |
    | EagleRAG | 20M | https://github.com/zhiweio/EagleRAG |
    | spec-kit | 12M | https://github.com/github/spec-kit |
    | Spexcode | 12M | https://github.com/shuxueshuxue/Spexcode |
    | OpenSpec | 10M | https://github.com/Fission-AI/OpenSpec |
    | obsidian-releases | 6.4M | https://github.com/obsidianmd/obsidian-releases |
    | Superpowers | 2.4M | https://github.com/obra/Superpowers |
    | obsidian-api | 424K | https://github.com/obsidianmd/obsidian-api |
- **根目录空壳/孤儿**: `.tmp-config-loader-tests/`(空,Jul 28)、`.tmp-config-loader-ttl/`(空,**Aug 6 — 测试仍在根目录拉屎**)、`.worktrees/`(空,Jul 15)、`schemas/`(仅 1 个 fabric-config.json,Apr 22,全仓唯一引用是它自己的 `$id` 字段 → 孤儿)。
- **scripts/ — 17 文件 / 2,653 行,5 个零接线 orphan**: habit-funnel.mjs / i18n-audit.mjs / migrate-two-layer-stores.mjs / nofake-audit.mjs / red-team-safety.mjs 在 package.json、3 个 workflow、lefthook.yml、RELEASING.md、docs/tooling-manifest.json 中均无引用;其余 12 个全部有 CI/package.json/lefthook 接线。
- **knip.config.ts 死条目**: ignoreDependencies 里 8 个包在**任何** package.json 中已不存在 — ink、@inkjs/ui、express、@preact/signals-core、autoprefixer、postcss、tailwindcss、picocolors(注释还在讲 "Dashboard: signals-core used via preact/signals"、"TODO: review during 1.8.x patch")。
- **hook 模板 5 份拷贝**: 同名 .cjs 分布在 packages/cli/templates/hooks(tracked, 43 文件 ≈16K 行,含 5,002 行**已提交的构建产物** project-context-runtime.cjs)+ packages/cli/.claude + packages/cli/.codex + 根 .claude/hooks + 根 .codex/hooks(后四处 untracked 安装拷贝)。五处合计 195 文件 / 68,107 行,唯一行数 15,973 → **52,134 行重复**;且 15 个文件在 cli 包内 dogfood 拷贝处已与 templates DIVERGED(如 project-root.cjs: templates/根 = 2 行 shim,cli 本地 = 旧版 59 行)—— 搜索噪声 + dogfood 漂移双重成本(git 层面只有 templates 一份,属磁盘/搜索面问题)。

### 精简提案

1. **worktree 三连清**: `git worktree remove` merged 的 mystifying-heisenberg(~300M 即时回收);另两个 07-30 后无活动、落后 12-13 commit,和 owner 确认后收割或删除 → 直接消解 hooks-runtime-generated 假红源。
2. `.workflow/` tracked 尸体归档: blueprint 37 + 已完结 active 28 + scratch 20 → 移 `.workflow/archive/`或删(git 历史在);roadmap.md 要么续写要么标 archived。
3. 根目录: 删 3 个空目录 + schemas/ 孤儿;给测试加 teardown 或把 `.tmp-config-loader-*` 移进 tmp/。
4. scripts/ 5 orphan 逐个判死(i18n-audit 见 §3;migrate-two-layer-stores 是一次性迁移脚本,迁移已完成即可删)。
5. knip.config.ts 清 8 条死 ignoreDependencies(它们在掩护未来真实的 unused-dep 告警)。
6. packages/cli/.claude + .codex 的 stale dogfood 拷贝重装或删除(untracked,零 git 风险)。

### 风险

- 未合并 worktree 各有 5 个本地 commit — 删除前必须 owner 过目(observability-fixes 与 sync-readme-version 都可能还想合)。
- kg/ 与 embedding/wiki-index/search-cache 是**活的** maestro 机器产物,不要清(mtime Aug 5-6)。
- knip 清理后需跑一次 `pnpm lint` 确认 zero-baseline 仍绿(可能暴露被掩护的真告警——这是收益不是风险,但要有人接)。

### 优先级: worktree 清理 **P0**(910M + 直接喂养 open flaky issue,成本一条命令);其余 **P2**

---

## 5. 测试全景(只统计,不评判)

### 现状证据(node walk 实测,排除 node_modules/dist)

| 区域 | 测试文件 | 测试行数 | 源码文件 | 源码行数 | 测试:源码 |
|---|---|---|---|---|---|
| packages/cli | 151 | 32,827 | 203 | 60,723 | 0.54 |
| packages/server | 97 | 29,289 | 112 | 27,382 | **1.07** |
| packages/shared | 57 | 10,509 | 76 | 14,410 | 0.73 |
| server-http-experimental | 10 | 1,899 | 14 | 1,804 | 1.05(从不运行) |
| scripts | 0 | 0 | 17 | 2,653 | — |
| **合计** | **315** | **74,524** | **422** | **106,972** | **0.70** |

口径注: cli 的"源码"含 templates/hooks + 两处 untracked dogfood 拷贝共 ~52K 重复 .cjs 行(§4);剔除重复后全仓手写源码约 5.5 万行,**有效测试:源码比更接近 1.3**。shared 细分: src 内嵌测试 8 文件 + `packages/shared/test/` 49 文件/9,009 行(最大 api-contracts.test.ts 1,056 行)。

**Top 测试文件**: doctor-cite-coverage.test.ts 2,887 / fabric-hint.test.ts 2,784 / review.test.ts 2,399 / knowledge-hint-broad.test.ts 2,028 / knowledge-hint-narrow.test.ts 1,861 — 前 8 名合计 ~17K 行,集中在 doctor/hint/review 三域。

**已知 flaky**: ISS-20260806-003(open)— 同 commit 连跑三次 30/31/32 个失败文件;§4 的嵌套 worktree 假红是已实证的贡献因子之一(本审计不跑测试,不做归因)。

### 精简提案 / 风险 / 优先级

规模本身不是问题(server 1.07 是契约面大的自然结果)。可操作项只有一条: exp 的 10 个测试文件/1,899 行随 §1 一起删。flaky 归因走既有 ISS-003,先做 §4 worktree 清理再测 flaky 基线(P0 的附带收益)。其余 **无行动建议**。

---

## 6. 跨包依赖形状

### 现状证据

**依赖 DAG(实测 package.json + import 计数)**:

```
shared (deps: 仅 zod)
  ↑ 169 imports ── server (deps: shared, @modelcontextprotocol/sdk, minimatch, zod)
  ↑ 55 imports ─┐
                ├─ cli (deps: shared, server, @clack/prompts, citty, string-width, tree-sitter×3)
  server ↑ 11 ──┘
[隔离] exp → server + shared (workspace:*,但已出 workspace,解析不到)
```

- **无循环、无反向**: server 源码 import `@fenglimg/fabric-cli` = **0**;shared 无任何内部包依赖。分层 shared ← server ← cli 干净成立。
- cli→server 的 11 处 import 是 CLI 命令复用 server 内核(runDoctorReport / appendEventLedgerEvent / collectStoreCanonicalEntries 等,见 packages/cli/src/commands/doctor.ts、preview.ts)——方向正确(上层调下层)。
- **dist 耦合(已知约束的实测确认)**: shared package.json exports 每个 subpath 都是 `development→src.ts, types→dist/*.d.ts, import→dist/*.js` 三键;共 **10 个 subpath**(., i18n, types, node, node/atomic-write, node/mcp-payload-guard, errors, schemas/api-contracts, templates/bootstrap-canonical, theme),tsup build 同列 10 entry。CI 顺序 `pnpm -r build` → `pnpm -r exec tsc --noEmit`(reusable-validate.yml:41-47)正确前置了 dist;本地漏 build 即"本地假红/CI 绿"(仓库 KB 已收录)。
- **边界守卫**: handler-project-context-census.test.ts 持续强制 exp 不回流(§1);theme 的 subpath(纯 cli 消费)是 10 个 export 里唯一"共享包为单端消费者背书"的条目(§2b)。

### 精简提案 / 风险 / 优先级

依赖形状是本次审计**唯一无需精简的项**。仅两条搭车建议: ① §1 删 exp 后,census 测试改为"包不存在"断言或整测试退役;② theme subpath 随 §2b 伪共享下沉一并处理。**无独立优先级。**

---

## 优先级汇总(供 roadmap 直接取用)

| 动作 | 优先级 | 一句话依据 |
|---|---|---|
| 清 .claude/worktrees(1 merged + 2 stale) | **P0** | 910M + 已实证喂养 open flaky ISS-003,一条命令 |
| 删 server-http-experimental 进 git 历史(+supersede KT-DEC-0016) | **P1** | 0 运行时耦合、代码已不编译、锁着三块下游尸体 |
| i18n 删 348 死键 ×2(dashboard 201 先行)+ census ratchet | **P1** | 27.8% 死键、有 parity gate 兜底、纯减法 |
| shared 死模块/死 schema 删除(~600 行) | **P1**(跟随 exp) | events.ts/human-lock/api-§10/Frontmatter 全零消费者 |
| api-contracts 按 11 banner 缝拆文件 | P2 | barrel 保稳,21 个消费文件零改动 |
| .workflow tracked 尸体归档 + 根目录孤儿 + knip 死条目 + 5 orphan scripts | P2 | 认知噪声,无运行时影响 |
| 伪共享下沉(theme/event-ledger 等 26 模块) | P2(搭车) | 发布包 API 变更,单独做性价比低 |
| 测试规模 / 依赖 DAG | 无行动 | server 1.07 合理;DAG 干净 |

---

## 附录 A: 20-key 死键抽样验证(全仓含测试 substring hits = 0)

cli.shared.missing / cli.config.write.success / cli.doctor.errors.cite-coverage-mutex / doctor.check.agents_meta.ok / doctor.check.knowledge_test_index.ok.link_singular.orphan_plural / doctor.check.counter_desync.name / cli.install.force-skills-only.uninitialised.message / cli.install.wizard.invalid-yes-no / cli.install.claude-settings.skipped-invalid / dashboard.app.nav.timeline.label-bilingual / dashboard.rule-topology.path.placeholder / dashboard.rule-topology.hit-reason.aria-label / dashboard.rules-tree.filter.placeholder / dashboard.human-lock.filters.all / dashboard.history-replay.subtitle / dashboard.history-replay.meta.na / dashboard.doctor.card.entry-points / dashboard.shared.status.stale / dashboard.lock-card.status.drift / dashboard.readiness.filter.analysis

## Caveats / Not Found

- **未跑任何测试/构建**(任务约束);"exp 不编译"结论来自符号级证据(http.ts:23 vs server barrel),非 tsc 输出。
- i18n 死键 348 为**保守下界**(动态前缀过度放行);真实死键可能更多(176 个被动态前缀豁免的 key 中还会有死的)。
- 伪共享判定基于静态 import 扫描,不含 dynamic import()/字符串反射;删除前按 §2 风险节兜底验证。
- `.workflow/harvest`、`milestones`、`explore`、`specs` 子目录未逐文件判活(合计 <400K,不影响结论)。
- 任务给的基线数字与实测的微小出入: 测试文件 307 vs 实测 315(口径含 exp 10 个 + shared src 内嵌)、exp 19 文件/2,603 行 vs 实测 tracked 27 文件(.ts 24 个/3,703 行)、shared 82 文件即 src 下 82 个 .ts(+3 json 数据文件)。
