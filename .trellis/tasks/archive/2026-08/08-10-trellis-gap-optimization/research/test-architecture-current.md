# Research: 测试架构现状 (test-architecture-current)

- **Query**: 盘清 fabric-v2 monorepo 测试框架现状（配置全景 / 类型普查 / 慢点 / 冗余 / 与死代码耦合），为「精简测试 + 剥离需 AI 运行时验证的部分」提供事实基础
- **Scope**: internal
- **Date**: 2026-08-10
- **方法**: Glob/Grep 工具 + `node -e` 静态 AST-lite 扫描（本机 Bash grep 是 ugrep,有假阴性,未用于普查）。**未跑任何测试**——所有"慢"的判断均为静态特征估算,标注为估算。

---

## 0. 口径与总量

| 指标 | 数值 |
|---|---|
| `*.test.ts` 文件总数 | **305** |
| — `packages/cli` | 145 |
| — `packages/server` | 96 |
| — `packages/shared` | 54 |
| — `packages/server-http-experimental` | 10（**不进 ship gate**,`test` script = `echo skipped && exit 0`） |
| 进主线 gate 的测试文件 | **295**（= 305 − 10 experimental,与任务描述一致） |
| 测试代码总行数 | **73,401** 行 |

---

## 1. 测试配置全景

### 1.1 vitest 配置矩阵

| 文件 | include | setupFiles | 特殊项 | coverage 阈值 |
|---|---|---|---|---|
| `packages/cli/vitest.config.ts` | `__tests__/**/*.test.ts` | `./vitest.setup.ts` | **`fileParallelism: false`**（全 CLI 套件**串行跑文件**）；`define.__CLI_VERSION__`；9 条 `@fenglimg/fabric-shared/*` → `../shared/src/*.ts` alias（走源码不走 dist） | lines/statements **70%** |
| `packages/server/vitest.config.ts` | 默认（`src/**/*.test.ts` + `__tests__/`） | `./vitest.setup.ts` | 无 include 覆写；靠 setup 强制 embedder 不可用 | **75%** |
| `packages/shared/vitest.config.ts` | `test/**/*.test.ts` + `src/**/*.test.ts` | 无 | **`testTimeout: 30_000` / `hookTimeout: 30_000`**（注释:为 windows-smoke 的 fs/git 慢而调大,Linux 同样生效） | **85%** |
| `packages/shared/vitest.smoke.config.ts` | 继承 base | — | `mergeConfig` 排除 3 个文件:`store/recall-perf`、`resolver/test-wall`、`store/migrate-two-layer` | 继承 |
| `packages/server-http-experimental/vitest.config.ts` | 默认 | 无 | 只有 alias；package `test` script 直接 echo skip | 无 |

**结论:全仓没有 unit / integration / e2e 的分层机制。**「分层」只体现在**目录命名约定**上,没有任何 config / CLI flag 能按层选跑:

| 约定 | 位置 | 文件数 |
|---|---|---|
| `__tests__/integration/` | cli 14 / server 2 / server-http-exp 3 | 19 |
| `test/integration/` | shared | 11 |
| `test/property-based/` | shared | 3 |
| 其余全部平铺 | `packages/cli/__tests__` 130 个、`packages/server/src/services` 74 个 | 204 |

唯一的运行时分层信号是 **env gate**:`packages/server/src/services/recall-dogfood-baseline.test.ts`(311 行)靠 `DOGFOOD_BASELINE=1` 才跑,默认 CI 跳过。全仓仅此一处。

### 1.2 setupFiles 做了什么

- `packages/cli/vitest.setup.ts`(28 行,顶层执行、**每文件一次**):
  - `process.env.FAB_LANG = "en"`
  - `process.env.FABRIC_HOME = mkdtempSync(...)` — **每个测试文件建一个 tmp home 且从不删除**(无 afterAll 清理)。145 个 CLI 文件 = 145 个 tmpdir 残留。
- `packages/server/vitest.setup.ts`(65 行,`beforeEach`/`afterEach`,**每个 test case**):
  - `__resetEmbedderForTesting(null)` — 全局把可选向量 embedder 钉成不可用,防 fastembed 模型下载(注释明说否则 5s+ 超时)。
  - `mkdtempSync` 建 FABRIC_HOME + `afterEach` `rmSync` 删。**这是 per-test 的一次 mkdtemp + 一次递归 rm**,server 侧每个 it 都付这份 IO 成本。
- shared 无 setupFiles。

### 1.3 `scripts/test-strategy-gate.mjs`(约 150 行)

**它不是测试,是文档漂移门。** 干的事:

1. 断言 7 个 `docs/methodology/*.md` 文件存在(`test-methodology-v6.md`、`e2e-methodology-FINAL.md`、`mainstream-research.md`、`samespace-research.md`、`trackd-research.md`、`backtest-answer-set.md`、`discovery-rubric.md`)。
2. 断言 `docs/TESTING.md` 含 6 个 H2 标题 + 11 个关键词字符串(`test:strategy`、`Windows smoke`、`PR hard` …)。
3. 断言 `package.json` 有 8 个 script key。
4. 断言 `.github/workflows/reusable-validate.yml` 逐字包含 8 条命令字符串 + 一条 `NO_COLOR=1 pnpm --filter @fenglimg/fabric-cli` 前缀。
5. 断言 `ci.yml` 含 3 条命令、`release.yml` 含 `reusable-validate.yml`。

**调用方**:只有 CI(`reusable-validate.yml` 的 "Testing strategy drift gate" step,`pnpm test:strategy`)。**lefthook 没有调用它** —— `lefthook.yml` 只有一条 pre-commit `node scripts/lint-stdio.mjs`,再无其他钩子。

### 1.4 CI 怎么跑测试

`.github/workflows/ci.yml` → 2 个 job:

**job `validate`** = `uses: ./.github/workflows/reusable-validate.yml`(ubuntu-latest,单 job 串行 13 步):

1. checkout / pnpm / node22 / `pnpm install --frozen-lockfile`
2. `pnpm -r build`
3. `pnpm -r exec tsc --noEmit`
4. `pnpm lint`(knip --strict)
5. **`pnpm -r --if-present test:coverage`** ← 全量 vitest + v8 coverage(cli/server/shared 三个包,cli 内部还是 `fileParallelism:false` 串行)
6. `pnpm test:strategy`
7. `pnpm test:store-only-e2e`(`scripts/store-only-e2e.mjs`)
8. `pnpm test:upgrade-e2e`(`scripts/upgrade-e2e.mjs`)
9. `node --experimental-strip-types scripts/lint-protected-tokens.ts`
10. **`NO_COLOR=1` 再跑一次 4 个 CLI 快照文件**(`i18n.test.ts`、`install-renderer-reskin.test.ts`、`doctor-reskin.test.ts`、`hud-reskin.test.ts`)—— 这 4 个文件在第 5 步已跑过一次,这里是**第二次运行**,只为换 NO_COLOR 环境。
11. `node scripts/perf-benchmark.mjs`(CLI + hook 冷启动 p95 门)
12. 上传 perf 报告

**job `windows-smoke`**(windows-latest,并行):install + build + `pnpm --filter @fenglimg/fabric-shared test:smoke`(shared 减 3 文件)+ `node dist/index.js --help/--version`。

`release.yml` 复用同一个 `reusable-validate.yml`(`verify_tag: true`),即**发版和 PR 跑同一套**。

**没有任何 job 并行拆分测试**;没有 shard;没有按变更范围选跑。CI 的测试成本 ≈ 第 5 步(全量 + coverage,单机串行)+ 第 10 步(重复跑 4 个文件)+ 第 7/8/11 步三个 node 脚本 E2E。**具体墙钟时间未测**(本次不跑测试);工作流没设 `timeout-minutes`,无历史时长可从文件读出。

### 1.5 scripts/ 目录:哪些进 gate,哪些没有

| 脚本 | 进 PR hard gate? | 说明 |
|---|---|---|
| `test-strategy-gate.mjs` | ✅ | 文档漂移门 |
| `store-only-e2e.mjs` | ✅ | 黑盒装/绑/写/审/召回 |
| `upgrade-e2e.mjs` | ✅ | 升级刷新 stale hook/skill |
| `perf-benchmark.mjs` | ✅ | 冷启动 p95 |
| `lint-protected-tokens.ts` | ✅ | 保护 token |
| `sync-versions.mjs` / `apply-tag-version.mjs` | release 才跑 | |
| `lint-stdio.mjs` | lefthook pre-commit | 唯一本地 hook |
| `dogfood-first-value.mjs` / `dogfood-multi-store.mjs` / `dogfood-quality-flywheel.mjs` / `habit-funnel.mjs` / `nofake-audit.mjs` / `red-team-safety.mjs` / `i18n-audit.mjs` | ❌ | `docs/TESTING.md` 归入 "Optional (not PR hard)";其中 nofake-audit / habit-funnel / red-team-safety 是**需要真实 AI 使用痕迹**才有意义的脚本,已经在 gate 外(既有先例) |
| `build-hook-project-context.mjs` / `migrate-two-layer-stores.mjs` | ❌ | 构建/迁移工具 |

> `docs/TESTING.md` 是策略权威入口(被 test-strategy-gate 钉住),已经存在 "PR hard / Release hard / Optional (not PR hard)" 三档划分 —— **剥离 AI 类测试有现成的落点:挪进 Optional 档。**

---

## 2. 测试类型普查(核心)

### 2.1 判定方法

按**静态 import / 调用特征**分桶,优先级从高到低(互斥):

1. **DIRECT-SUBPROC**:源码里出现 `execFileSync` / `execSync` / `spawnSync` / `spawn(`
2. **INDIRECT-SUBPROC**:不直接 spawn,但 import 了会 spawn 的 helper(`helpers/init-test-utils`、`test/helpers/test-wall`、`test/helpers/git-worktree-fixture` —— 后两者内部 `execFileSync("git", …)`)
3. **FS-FIXTURE**:出现 `mkdtempSync` / `mkdtemp(` / `writeFileSync` / `cpSync`,无子进程
4. **PURE**:以上全无(纯输入→输出;含用 `createRequire` 在**进程内**加载 `.cjs` 的 hook 契约测试)

另加两个**正交标签**(与上面分桶交叉):
- **HOOK-CJS**:文件里引用 `templates/hooks/**/*.cjs`(用 `createRequire` 在进程内 require 真 hook 脚本)
- **ARTIFACT-TEXT**:读 `templates/`、`docs/`、`README.md`、`AGENTS.md`、`SKILL.md`、`bootstrap-canonical`、`parity-matrix` 并对其**文本**做 `toContain`/`toMatch` 断言

### 2.2 分桶结果

| 桶 | 文件数 | 占比 | 行数 | 行占比 |
|---|---:|---:|---:|---:|
| **PURE**(纯逻辑,无 IO) | 111 | 36.4% | 16,567 | 22.6% |
| **FS-FIXTURE**(临时目录 / 写文件 / 快照对比) | 144 | 47.2% | 43,533 | **59.3%** |
| **INDIRECT-SUBPROC**(经 helper 起 git / install) | 22 | 7.2% | 4,899 | 6.7% |
| **DIRECT-SUBPROC**(自己 spawn) | 28 | 9.2% | 8,402 | 11.4% |
| 合计 | 305 | 100% | 73,401 | 100% |

**关键数字:59% 的测试代码是文件系统 fixture 测试,再加 18% 的子进程测试 —— 约 77% 的测试代码带真实 IO。** 只有 22.6% 是纯逻辑。

另:**168 个文件出现 `mkdtempSync`/`mkdtemp(`**(占 55%),**202 个文件 import `node:fs`**(占 66%)。

### 2.3 各子类明细

#### (a) 纯逻辑单测 — 111 文件 / 16,567 行
典型:`packages/shared/test/cite-line-parser.test.ts`(459)、`packages/shared/src/schemas/event-ledger.test.ts`(675)、`packages/shared/test/api-contracts.test.ts`(1,057)、`packages/server/src/services/plan-context-scope-rank.test.ts`(131)。
其中 shared 的 `src/schemas/*.test.ts`(4 个)、`test/property-based/`(3 个)是最干净的一类。

#### (b) 文件系统 fixture 测试 — 144 文件 / 43,533 行(最慢的一类)
再细分:
- **真跑 install 流水线**(调 `runInit` / `executeInitExecutionPlan` / `installHooks` / `installFabric*Skill`):**15 文件 / 4,275 行**。cli config 注释明说每次 install ≈ **93 个 hook/skill 文件**的原子写(temp + rename)。这是 `fileParallelism:false` 的直接原因(注释:并行时 rename 竞态造成 30+ 非确定性失败)。
- **fixture 树复制**:`cpSync` 全仓只有 **1 处** —— `packages/cli/__tests__/helpers/init-test-utils.ts` 的 `createWerewolfFixtureRoot()`,`cpSync(fixtures/cocos-stub, root, {recursive:true})`。被 **16 个测试文件**间接调用,每个 `beforeEach`/每个用例都复制一次 20 文件 / 84K 的树。
- **tar 解压 fixture**:`packages/server/__tests__/__fixtures__/werewolf-snapshot.tar.gz`(**108K**),被 `packages/server/__tests__/werewolf-fixture.test.ts` 和 `packages/cli/__tests__/cross-client-parity.test.ts` 解包。
- 其余是 seed 临时 store / knowledge 条目再调 service 的 doctor / recall / review 类测试。

#### (c) 子进程 / CLI e2e — 50 文件 / 13,301 行
直接 spawn 的 28 个(spawn 调用点次数,`git` 相关次数):

| 次数 | git | 行 | 文件 |
|---:|---:|---:|---|
| 8 | 7 | 415 | `packages/cli/__tests__/forensic.test.ts` |
| 8 | 6 | 465 | `packages/cli/__tests__/run-sync.test.ts` |
| 6 | 5 | 855 | `packages/server/__tests__/integration/fab-review.test.ts` |
| 6 | 5 | 258 | `packages/server/src/tools/mcp-server.test.ts` |
| 4 | 3 | 221 | `packages/cli/__tests__/install-url-bind.test.ts` |
| 4 | 3 | 87 | `packages/cli/__tests__/run-global-install.test.ts` |
| 4 | 2 | 56 | `packages/cli/__tests__/run-sync-pull-error.test.ts` |
| 4 | 3 | 76 | `packages/server/__tests__/project-context-matrix.test.ts` |
| 4 | 3 | **2,399** | `packages/server/src/services/review.test.ts` |
| 4 | 3 | 362 | `packages/server/src/tools/pending.test.ts` |
| 4 | 3 | 498 | `packages/server/src/tools/review.test.ts` |
| 3 | 2 | 106 | `packages/cli/__tests__/backfill-unbound-project.test.ts` |
| 3 | 2 | 106 | `packages/cli/__tests__/info-ops.test.ts` |
| 3 | 1 | 433 | `packages/cli/__tests__/store-ops.test.ts` |
| 3 | 2 | 54 | `packages/cli/__tests__/uid-salt.test.ts` |
| 2 | — | 149 | `packages/cli/__tests__/cross-client-parity.test.ts` |
| 2 | 1 | 134 | `packages/cli/__tests__/hooks-lib-project-root.test.ts` |
| 2 | — | 89 | `packages/cli/__tests__/hooks-runtime-generated.test.ts` |
| 2 | 1 | 283 | `packages/cli/__tests__/scope-backfill.test.ts` |
| 2 | — | 91 | `packages/server/__tests__/werewolf-fixture.test.ts` |
| 2 | 1 | 69 | `packages/server/src/project-context-provider.test.ts` |
| 2 | 1 | 296 | `packages/server/src/services/doctor-relevance-paths.test.ts` |
| 2 | 1 | 199 | `packages/server/src/services/rehydrate-state.test.ts` |
| 2 | 1 | 122 | `packages/shared/test/resolver/project-context-resolver.test.ts` |
| 2 | 1 | 240 | `packages/shared/test/store/store-core.test.ts` |
| 1 | — | 127 | `packages/cli/__tests__/install-v2-preflight-stage.test.ts` |
| 1 | — | 117 | `packages/cli/__tests__/run-global-install-arg-safety.test.ts` |
| 1 | — | 95 | `packages/cli/__tests__/run-global-install-feedback.test.ts` |

间接经 helper 起子进程的 22 个(见 §5 表)。

引用**真实 CLI 二进制 / `process.execPath` / `"node"`** 的 11 个文件:`cli-entry-noargs`、`client-configs`、`config-atomic`、`config-install`、`config-panel`、`hooks-runtime-generated`、`init-wizard`、`integration/codex-mcp-install`、`integration/init-scope`、`mcp-config-merge`、`unknown-flags`。

**注意一条明确的既有政策**:`knowledge-hint-broad.test.ts` 头部注释写「per signal-handler / fabric-hint test policy: **in-process invocation only, NO child_process.spawn in CI**」。所以 hook 类测试是**进程内 `createRequire` 加载 `.cjs`** —— 39 个文件 / **14,291 行**属于这一类(见 2.3(e))。

#### (d) 快照 / parity 测试
**vitest 快照** — 12 文件用 `toMatchSnapshot`,9 个 `.snap` 落盘:

| `.snap` | 归属 |
|---|---|
| `packages/cli/__tests__/__snapshots__/` | `cli-surface`、`client-configs`、`doctor-reskin`、`hud-reskin`、`i18n`、`install-renderer-reskin`、`mcp-config-merge`、`theme-clack` |
| `packages/server/__tests__/__snapshots__/` | `tool-contracts` |
| `packages/server/src/services/__snapshots__/` | `doctor-i18n` |
| (无 snap 的 inline) | `forensic-shadow-mirroring`、`event-ledger-census` |

另有 `packages/cli/__tests__/snapshot-hygiene.test.ts`(33 行)—— 一个专门断言"没有孤儿 .snap"的元测试。

**parity 家族**(10 文件 / **1,220 行**):

| 行 | 文件 | 断言什么 |
|---:|---|---|
| 82 | `cli/__tests__/ai-client-policy-drift.test.ts` | README/QUICKSTART/AGENTS.md/bootstrap 模板的**散文措辞**不含过期表述 |
| 111 | `cli/__tests__/cite-line-parser-parity.test.ts` | TS 源 ↔ 手写 `.cjs` 孪生 对 40+ 输入语料**行为等价** |
| 149 | `cli/__tests__/cross-client-parity.test.ts` | 真 install 后 `.claude` vs `.codex` 的 hook/skill **字节等价** |
| 147 | `cli/__tests__/integration/parity-matrix-e2e.test.ts` | `parity-matrix.json` 每个 (capability × client) 格子真被装出来 |
| 69 | `cli/__tests__/render-backlog-line-parity.test.ts` | **其它测试里的 stub 字面量** ↔ 真实现 `renderBacklogAgeLine` 字节等价 |
| 88 | `cli/__tests__/theme-parity.test.ts` | `shared/src/theme.ts` ↔ `templates/hooks/lib/theme.cjs` 表与 `paint()` 字节等价 |
| 260 | `server/src/services/doctor-project-registry-drift.test.ts` | registry 漂移检测 |
| 124 | `server/src/store-config-reader-parity.test.ts` | hook `store-config-reader.cjs` ↔ server `resolveStoreConfig` 同 fixture 同结果 |
| 40 | `shared/src/i18n/locale-parity.test.ts` | 两语言 key 集合对齐 |
| 150 | `shared/test/templates/bootstrap-parity.test.ts` | ZH ↔ EN bootstrap 正文结构 + **保护 token 逐字**在两边都在 |

加上 `shared/test/integration/i18n-protected-tokens.test.ts`(148)和 `shared/src/services/high-value-sst.test.ts` 式的 SST round-trip,**"手写孪生的等价断言"这一族总计约 1,370 行**。它们全部因为**同一份逻辑有 TS 与 `.cjs` 两份实现**而存在:消灭重复实现,这一族就整体消失。

#### (e) hook `.cjs` 契约测试 — 39 文件 / 14,291 行(占测试总行 19.5%)
用 `createRequire` 在进程内加载 `packages/cli/templates/hooks/**/*.cjs`,断言导出函数的输出。最大的四个:`fabric-hint.test.ts`(2,784 / 146 个 it)、`knowledge-hint-broad.test.ts`(2,028 / 85 个 it)、`knowledge-hint-narrow.test.ts`(1,861)、`fabric-hint-cite.test.ts`(562)。这四个合计 **7,235 行,占全仓测试 9.9%**。

---

### 2.4 「AI 行为」类测试清单 ★ 本节是重构关键输入

判定口径:**断言对象是"给 AI 看的自然语言 / 文案 / markdown 措辞",而不是程序对程序的数据契约。** 分三档。

#### 档 A — 断言 markdown / 文档散文措辞(最纯粹的 AI-facing text,零程序契约成分)

| 行 | 文件 | 断言什么 |
|---:|---|---|
| 82 | `packages/cli/__tests__/ai-client-policy-drift.test.ts` | 把 `README.md` + `docs/USER-QUICKSTART.md` + `templates/hooks/configs/README.md` 拼成一坨字符串,断言**不含** "Fabric exposes six MCP tools and three Skills"、"UserPromptSubmit cite-policy hook"、"`<repo>/.fabric/knowledge/pending`" 等过期句子;断言 `bootstrap-canonical.ts` + `.fabric/AGENTS.md` + `AGENTS.md` **含中文句子** "`.fabric/agents.meta.json` 严禁手动编辑";断言 `templates/skills/fabric-archive/ref/phase-1-5-onboard.md` 含 "fabric-hint.cjs" 不含 "from `archive-hint.cjs`";断言 `fabric-recall-playbook/SKILL.md` 与 bootstrap 都教 "fab_recall(paths=" |
| 164 | `packages/cli/__tests__/integration/archive-skill-trigger-gate.test.ts` | **文件头注释自认**:「SKILL.md 是 LLM 驱动的 markdown spec,没有可执行代码路径;被拒方案是 per-entry_point spawn 一个 Claude Code session(brittle, slow),选定方案是 grep + parse markdown」。实际断言:从 `ref/phase-1-5-onboard.md` 抠出 "#### Phase 1.5 Trigger Gate" 区块,逐个校验 E1–E5 五个 entry-point 的措辞标记(`decision:'block'`、`/fabric-archive`、`今日复盘` / `daily recap` 等)存在。**这是「AI 该怎么响应」的纯文档 grep,30 处 toContain。** |
| 195 | `packages/shared/test/templates/bootstrap-canonical.test.ts` | 对 `BOOTSTRAP_CANONICAL_ZH`(注入 AI 的中文行为规约正文)做 41 处文本断言:含 `## For Developers` / `## 行为规则` / `## 知识库(KB)` / `## Cite policy` 标题;For Developers 段必须排在 AI 段之前;正文 **≥800 bytes**;含 "KB: <id>"、"自动记账"、"无需手写"、"dismissed: <id>"、"applied\|dismissed" 等**中文/半中文措辞** |
| 150 | `packages/shared/test/templates/bootstrap-parity.test.ts` | ZH/EN 两份 bootstrap 正文的**结构 + 保护 token 逐字**清单(`fabric install`、`fab_recall`、`fab_pending action="list"`、`atlas.premultiplyAlpha`、四个 skill 名 …) |
| 148 | `packages/shared/test/integration/i18n-protected-tokens.test.ts` | i18n 翻译中保护 token 不被翻译 |
| 60 | `packages/cli/__tests__/skills-store-aware.test.ts` | 13 处 toContain,断言 skill markdown 里有 store-aware 措辞 |
| 133 | `packages/cli/__tests__/skill-size-validator.test.ts` | SKILL.md token 预算(chars/3)与超限错误文案含 "progressive disclosure" / "Install aborted" |
| 240 | `packages/server/src/services/doctor-skill-lints.test.ts` | lint SKILL.md 的 **description 写得好不好**:是否双语、是否有 "(NOT code review)" 这类 anti-trigger 边界、token 预算 |
| 85 | `packages/server/src/services/doctor-retired-references-lint.test.ts` | 文档中是否还引用已退役的名字 |
| 102 | `packages/server/src/services/doctor-audience-tag.test.ts` | 受众标签措辞 |
| **档 A 小计** | **1,359 行 / 10 文件** | |

#### 档 B — 断言 hook / CLI 输出的自然语言文案(程序输出,但被断言的是给 AI/人读的措辞)

| 行 | CJK 字面量断言数 | 文件 | 断言什么 |
|---:|---:|---|---|
| 2,784 | **28** | `packages/cli/__tests__/fabric-hint.test.ts` | Stop hook 输出的中文 nudge 文案、banner、backlog 提示句(146 个 it) |
| 2,028 | 9 | `packages/cli/__tests__/knowledge-hint-broad.test.ts` | SessionStart 注入正文:`renderSummary` / `renderFull` / `renderTruncated` / `truncateSummary` 的**渲染文本行**、`IMPORT_RECOMMENDATION_BANNER` 措辞 |
| 1,861 | 2 | `packages/cli/__tests__/knowledge-hint-narrow.test.ts` | PreToolUse narrow hint 文案 |
| 562 | — | `packages/cli/__tests__/fabric-hint-cite.test.ts` | cite 提示文案 |
| 488 | — | `packages/cli/__tests__/banner-i18n.test.ts` | 13 个 banner key × 4 语言变体 = 52 组合的**翻译文案**;断言"确实翻译了"(变体特有子串在)+ 保护 token 逐字幸存(`/fabric-archive`、`` `fabric doctor` ``、`📋 Fabric:` 前缀) |
| 432 | — | `packages/cli/__tests__/cite-policy-evict.test.ts` | cite 策略提示 |
| 416 | 1 | `packages/cli/__tests__/summarize-transcript.test.ts` | 解析 **AI 会话 transcript**(Claude Code / Codex 两种 JSONL 形状)生成 digest |
| 354 | — | `packages/cli/__tests__/session-digest-writer.test.ts` | session digest 文案 |
| 194 | — | `packages/cli/__tests__/nudge-preset-derivation.test.ts` | nudge 档位派生 |
| 185 | — | `packages/cli/__tests__/i18n.test.ts` | zh-CN / en 两份**全 CLI 输出快照** |
| 177 | — | `packages/cli/__tests__/fabric-hint-graph-edge.test.ts` | 图边提示 |
| 169 | — | `packages/cli/__tests__/error-render.test.ts` | 错误文案渲染 |
| 158 | — | `packages/cli/__tests__/fabric-hint-dismiss.test.ts` | dismiss 文案 |
| 158 | — | `packages/cli/__tests__/nudge-mode-4-layer.test.ts` | 4 层 nudge 模式 |
| 112 | — | `packages/cli/__tests__/install-renderer-reskin.test.ts` | 安装器皮肤快照 |
| 106 | — | `packages/cli/__tests__/hud-reskin.test.ts` | HUD 皮肤快照 |
| 104 | 7 | `packages/cli/__tests__/i18n-project-commands.test.ts` | 项目命令中文描述 |
| 83 | — | `packages/cli/__tests__/fabric-hint-never-blocks.test.ts` | 守 KT-DEC-0007(hook 不得 block) |
| 76 | — | `packages/cli/__tests__/theme-clack.test.ts` | 主题快照 |
| 74 | — | `packages/cli/__tests__/doctor-reskin.test.ts` | doctor 皮肤快照 |
| 51 | — | `packages/cli/__tests__/command-signposts.test.ts` | 命令路标文案 |
| 196 | — | `packages/server/src/services/doctor-i18n.test.ts` | doctor 输出的中英文快照 |
| **档 B 小计** | | **~10,768 行 / 22 文件(占测试总行 14.7%)** | |

#### 档 C — 断言"AI 判断力"的启发式(逻辑是确定的,但被测的是 AI 领域启发式,且真实效果只有跑真 AI 才知道)

| 行 | 文件 | 断言什么 |
|---:|---|---|
| 1,648 | `packages/server/src/services/extract-knowledge.test.ts` | 从会话中抽取知识条目的启发式:`assessBodyAltitude`(正文"高度"够不够)、`quoteRelevancePath`、pending 落盘形状。116 处 toContain |
| 2,887 | `packages/server/src/services/doctor-cite-coverage.test.ts` | **cite 覆盖率记账** —— AI 有没有在改文件前 recall、recall 有没有算作引用。86 个 it。这套指标的真值来自真实 AI 会话 |
| 311 | `packages/server/src/services/recall-dogfood-baseline.test.ts` | **已经在 gate 外**(`DOGFOOD_BASELINE=1`),跑真实 `~/.fabric` store 测 self-retrieval@1/@3、rank 分布。**这是"需要真 AI/真语料才有意义"的既有先例** |
| 116 | `packages/server/src/services/high-value-sst.test.ts` | "这个 session 值不值得归档"高价值判定的 TS ↔ cjs round-trip |
| 214 | `packages/server/__tests__/archive-attempt-outcomes.test.ts` | 归档尝试 4 种 outcome(proposed / viability_failed / user_dismissed)的事件 round-trip —— outcome 由 AI 在 skill 内决定 |
| 106 | `packages/server/src/services/doctor-body-altitude.test.ts` | 知识正文"高度"lint |
| 410 | `packages/server/src/services/doctor-body-dedup.test.ts` | 知识正文去重启发式 |
| 124 | `packages/server/src/services/doctor-consumption-lint.test.ts` | 知识"被消费"lint |
| **档 C 小计** | **5,816 行 / 8 文件** | |

#### 三档汇总

| 档 | 文件 | 行 | 占测试总行 |
|---|---:|---:|---:|
| A 文档/skill markdown 措辞 | 10 | 1,359 | 1.9% |
| B hook/CLI 自然语言文案 + i18n | 22 | 10,768 | 14.7% |
| C AI 领域启发式 / 记账 | 8 | 5,816 | 7.9% |
| **合计** | **40** | **17,943** | **24.4%** |

> 全仓「预期值字面量含中文」的断言:**19 个文件 / 84 处**(用 `(toContain|toBe|toMatch|toEqual)\(...CJK...\)` 扫出)。Top:`fabric-hint`(28)、`knowledge-hint-broad`(9)、`i18n-project-commands`(7)、`preview-title`(5)、`bootstrap-canonical`(5)。

**边界提醒**:档 B/C 里的绝大部分断言在**当前形态下是确定性的**(输入固定 → 输出字符串固定),它们不需要 AI 在运行时参与就能跑绿。用户的原则若严格执行,真正"需要 AI 运行时验证"的只有档 A 的 `archive-skill-trigger-gate`(自认是 spawn-Claude-session 的替代品)、`ai-client-policy-drift`(散文措辞)、`doctor-skill-lints` 的 description 质量判定,以及档 C 的 `recall-dogfood-baseline`(已在 gate 外)。其余是"AI-facing 文案的回归锁",成本高但确定性成立 —— **是否剥离是价值判断,不是技术判断**,本节只给事实。

---

## 3. 慢点定位(静态估算,未实测)

### 3.1 结构性慢因(config 层)

| 慢因 | 证据 | 影响面 |
|---|---|---|
| **CLI 全套件文件串行** | `packages/cli/vitest.config.ts` `fileParallelism: false` | **145 个文件**无法并行,是 CI 第 5 步的主要墙钟来源。注释说明原因是 install 测试的 rename 竞态 |
| **server 每个 test case 一次 mkdtemp + 递归 rm** | `packages/server/vitest.setup.ts` `beforeEach`/`afterEach` | 96 个文件里**所有** it(粗估上千个),每个都付两次 fs syscall |
| **CLI 每个文件一次 mkdtemp 且不清理** | `packages/cli/vitest.setup.ts` 顶层 `mkdtempSync` | 145 个 tmpdir 泄漏 |
| **shared timeout 调到 30s** | `testTimeout: 30_000` / `hookTimeout: 30_000` | 掩盖慢用例:任何 <30s 的慢都不会红,失去"慢即失败"的反馈 |
| **CI 重复跑 4 个文件** | `reusable-validate.yml` 第 10 步 NO_COLOR 重跑 `i18n` / `install-renderer-reskin` / `doctor-reskin` / `hud-reskin`(共 477 行) | 纯重复开销 |
| **coverage v8 全量插桩** | 三个包都 `test:coverage` | 相对裸 `vitest run` 有固定放大 |

### 3.2 按静态特征排的重点嫌疑文件

**(a) 每次用例复制 fixture 树** — `cpSync` 全仓仅 1 处但被 16 个文件消费:

`packages/cli/__tests__/helpers/init-test-utils.ts::createWerewolfFixtureRoot()` → `cpSync(__tests__/fixtures/cocos-stub → tmp, {recursive:true})`,随后 `rmSync` 三次。消费者(16):
`deprecated-skills-cleanup`、`forensic`、`i18n`、`init-atomic`、`init-forensic`、`init-wizard`、`install-cli-surface`、`install-scaffold-default-silent`、`integration/bootstrap-snapshot`、`integration/init-guard`、`integration/init-scope`、`integration/install-diff-mode`、`integration/install-skills-and-hooks`、`integration/parity-matrix-e2e`、`integration/uninstall-skills-and-hooks`、`uninstall`。

**(b) 真跑 install 流水线(每次 ~93 文件原子写)** — 15 文件 / 4,275 行。最大的:
`integration/install-skills-and-hooks.test.ts`(896)、`integration/uninstall-skills-and-hooks.test.ts`(507)、`uninstall.test.ts`(661)、`install-v2-pipeline.test.ts`(455)、`integration/install-diff-mode.test.ts`(288)。

**(c) 真实 git 操作** — 见 §2.3(c) 表的 `git` 列;另外两个 helper 内部就是 git 驱动:
- `packages/shared/test/helpers/test-wall.ts` — `git init --bare` 假远端 + clone + seed + push,消费者 5 个(`resolver/test-wall`、`resolver/golden-redsuite`、`resolver/store-executable-guard`、`store/*`)
- `packages/shared/test/helpers/git-worktree-fixture.ts` — 建 main / linked worktree / unrelated 三个仓,消费者含 `server/__tests__/project-context-matrix`、`cli/__tests__/integration/project-context-client-matrix`

**(d) 子进程 spawn** — 28 文件直接 spawn(§2.3(c) 完整表),11 文件 spawn 真实 `node dist/index.js` / `process.execPath`。

**(e) tar 解包** — `server/__tests__/__fixtures__/werewolf-snapshot.tar.gz`(108K),2 个文件解包。

### 3.3 fixtures 体积

| 目录 | 文件数 | 体积 |
|---|---:|---:|
| `packages/server/__tests__/__fixtures__/` | 2 | **108K**(含 werewolf-snapshot.tar.gz) |
| `packages/cli/__tests__/fixtures/` | 20 | **84K**(cocos-stub 项目树,含 3 个 `.ts` 源文件桩) |
| `packages/shared/test/fixtures/` | 1 | 8K |
| 合计 | 23 | 200K |

体积本身不大;成本在**复制频次**(每个 beforeEach)而非体积。

### 3.4 显式调大 timeout 的地方(慢的暗示)

- `packages/shared/vitest.config.ts`:`testTimeout: 30_000` + `hookTimeout: 30_000`(**全包**)
- `packages/server-http-experimental/src/api/events.test.ts`:单处 `}, 10_000)`(该包不进 gate)
- 其余 305 个文件**没有**任何 per-test timeout 覆写。
- 跳过标记极少:全仓 5 处 `.skip`/`.todo`/`skipIf`(`install-skills-and-hooks` 1、`signal-handler` 1、`http-endpoints` 1、`store-executable-guard` 2)。

---

## 4. 冗余与重复

### 4.1 install / init / uninstall 家族:35 个文件、7,048 行

同一条 install 路径被切成 35 个测试文件。差别维度:

| 维度 | 文件 |
|---|---|
| 渲染层 | `install-render-flow`(149)、`install-renderer-reskin`(112)、`install-renderer-step-singleline`(85)、`install-v2-pipeline-render`(290)、`install-forensic-progress`(67) |
| pipeline stage | `install-v2-pipeline`(455)、`install-v2-preflight-stage`(127)、`install-v2-hooks-stage`(114)、`install-v2-dry-run`(111)、`validate.stage`、`store.stage.dualslot` |
| guidance 文案 | `install-v2-guidance-dedupe`(53)、`install-v2-guidance-refresh-snapshot`(209) |
| 全局装 | `install-global`(154)、`run-global-install`(87)、`run-global-install-arg-safety`(117)、`run-global-install-feedback`(95) |
| 事务/原子 | `install-transaction`(83)、`init-atomic`(255) |
| 端到端 | `integration/install-skills-and-hooks`(896)、`integration/install-diff-mode`(288)、`integration/init-guard`(182)、`integration/init-scope`(163)、`integration/codex-mcp-install`(174) |
| 卸载 | `uninstall`(661)、`integration/uninstall-skills-and-hooks`(507) |
| 向导 | `init-wizard`(184)、`init-wizard-adapter`(110) |
| 其它 | `config-install`、`hooks-install-validate`、`install-url-bind`、`install-cli-surface`、`install-scaffold-default-silent`、`init-forensic`、`init-context-shadow-mirroring` |

**其中 `install-render-flow` / `install-renderer-reskin` / `install-renderer-step-singleline` 三个共 346 行全部打在同一个已不可达的 `src/tui/ConsoleOutputRenderer.ts` 上(见 §5)。**

### 4.2 doctor 家族:41 个文件、12,006 行(占测试总行 16.4%)

`packages/server/src/services/doctor-*.test.ts` 有 32 个,加 `doctor.test.ts`(1,834)和 `doctor-cite-coverage.test.ts`(2,887)。这两个巨型文件与 32 个小 lint 文件之间的边界不清晰(如 `doctor-skill-lints` vs `doctor.test.ts` 内的 skill 检查)。

其他家族规模:hint 10 文件 / 8,341 行;store 36 / 5,626;cite 7 / 5,054;review 9 / 4,202;config 17 / 3,460;recall 7 / 2,135。

### 4.3 parity 家族(为"防重复实现漂移"而存在)

见 §2.3(d):**10 个 parity 文件 1,220 行**,加上 `i18n-protected-tokens`(148)= **1,368 行**。这些测试的存在前提是**同一逻辑有两份手写实现**:

| 重复实现对 | 守它的 parity 测试 |
|---|---|
| `shared/src/cite-line-parser.ts` ↔ `templates/hooks/lib/cite-line-parser.cjs` | `cite-line-parser-parity.test.ts`(111) |
| `shared/src/theme.ts` ↔ `templates/hooks/lib/theme.cjs` | `theme-parity.test.ts`(88) |
| `shared/src/high-value-predicate.ts` ↔ `templates/hooks/lib/high-value-predicate.cjs` | `high-value-sst.test.ts`(116) |
| server `resolveStoreConfig` ↔ `templates/hooks/lib/store-config-reader.cjs` | `store-config-reader-parity.test.ts`(124) |
| `BOOTSTRAP_CANONICAL_ZH` ↔ `BOOTSTRAP_CANONICAL_EN` | `bootstrap-parity.test.ts`(150) |
| `.claude/*` 安装产物 ↔ `.codex/*` 安装产物 | `cross-client-parity.test.ts`(149)、`parity-matrix-e2e.test.ts`(147) |
| 别的测试里的 **stub 字面量** ↔ 真实现 | `render-backlog-line-parity.test.ts`(69) — 这一个是「为了守其他测试的 stub」而写的测试 |

消除 TS/`.cjs` 双实现 → 前 4 行(439 行)整体消失;消除测试内 stub → 第 7 行(69 行)消失。

### 4.4 超长测试文件 Top 10

| 行 | 文件 | it 数 |
|---:|---|---:|
| 2,887 | `packages/server/src/services/doctor-cite-coverage.test.ts` | 86 |
| 2,784 | `packages/cli/__tests__/fabric-hint.test.ts` | 146 |
| 2,399 | `packages/server/src/services/review.test.ts` | — |
| 2,028 | `packages/cli/__tests__/knowledge-hint-broad.test.ts` | 85 |
| 1,861 | `packages/cli/__tests__/knowledge-hint-narrow.test.ts` | — |
| 1,834 | `packages/server/src/services/doctor.test.ts` | — |
| 1,648 | `packages/server/src/services/extract-knowledge.test.ts` | — |
| 1,597 | `packages/server/src/services/plan-context.test.ts` | — |
| 1,247 | `packages/server/src/services/event-ledger.test.ts` | — |
| 1,057 | `packages/shared/test/api-contracts.test.ts` | — |

Top 10 合计 **19,342 行 = 全仓测试的 26.4%**(10/305 = 3.3% 的文件)。

---

## 5. 与生产代码的耦合:测试基础设施钉住死代码

### 5.1 方法

对每个包做**从 entrypoint 出发的值-import 可达性闭包**(`import type` 不算可达;跟随 `import()` 动态导入),再与 `src/**` 全集求差。cli 的 entrypoint 是 `src/index.ts`(它经 `src/commands/index.ts` 的 `import().then()` 懒加载注册命令)。

### 5.2 packages/cli:**2,270 行运行时不可达,全部被测试钉住**

`packages/cli/src/commands/index.ts:8` 已经把 `install` 指向 `./install-v2.js`(237 行),旧的 `commands/install.ts` **不再被任何命令注册**。7 个 `src/install/*.ts` 文件确实 import 它,但**全部是 `import type`**(逐一核实:`install-diff.ts`、`install-path-output.ts`、`install-stage-output.ts`、`install-summary.ts`、`install-wizard.ts` 只取 `InitOptions` / `InitWriteAction` / `AgentsMdAction` / `InitStage*` 类型;`hooks-orchestrator.ts` / `skills-and-hooks.ts` 只在注释里提到)。所以 `installCommand` / `runInitCommand` / `buildInitExecutionPlan` / `executeInitExecutionPlan` / `initFabric` 等**运行时符号无生产调用方**。

| 行 | 不可达模块 | 钉住它的测试 |
|---:|---|---|
| **1,093** | `src/commands/install.ts` | **16 个**:`cli-entry-noargs`、`cli-surface`、`i18n`、`init-atomic`、`init-forensic`、`init-wizard-adapter`、`init-wizard`、`install-cli-surface`、`install-forensic-progress`、`install-scaffold-default-silent`、`install-url-bind`、`integration/init-guard`、`integration/install-skills-and-hooks`、`uninstall`、`shared/test/store/observability`,以及 helper `__tests__/helpers/init-test-utils.ts`(它再被 16 个文件消费) |
| 317 | `src/tui/ConsoleOutputRenderer.ts` | 3 个:`install-render-flow`、`install-renderer-reskin`、`install-renderer-step-singleline`(共 346 行)。**注意 `install-renderer-reskin` 还被 CI 第 10 步 NO_COLOR 单独重跑** |
| 234 | `src/install/install-wizard.ts` | **0** |
| 201 | `src/install/install-summary.ts` | **0** |
| 192 | `src/install/install-onboarding.ts` | 1:`backfill-unbound-project.test.ts` |
| 85 | `src/install/install-diff.ts` | 0 |
| 65 | `src/install/install-stage-output.ts` | 0 |
| 43 | `src/install/install-labels.ts` | 0 |
| 21 | `src/install/install-path-output.ts` | 0 |
| 19 | `src/install/install-local-server.ts` | 0 |
| 257 | `src/install/pipeline/types.ts` | 纯类型(可达性分析中因只被 type-import 而落这里,非真死码) |
| 127 | `src/tui/types.ts` | 同上 |

**净结论:约 1,410 行(install.ts 1,093 + ConsoleOutputRenderer 317)是"只有测试在用"的死代码,由 19 个测试文件 + 1 个 helper 钉住;另有 860 行(install-wizard / install-summary / install-diff / install-stage-output / install-labels / install-path-output / install-local-server / install-onboarding)连测试都没有,是纯死码,knip 也抓不到 —— 因为 `knip.config.ts` 把 `src/commands/**/*.ts` 和 `src/install/**/*.ts` 整目录列为 entry。**

任务描述里说的「1,961 行」与我算的 1,093(install.ts 本体)/ 2,270(全部不可达)是同一现象的不同切法。

### 5.3 packages/server:1 处

| 行 | 模块 | 情况 |
|---:|---|---|
| 115 | `src/services/doctor-test-helpers.ts` | **测试专用 helper 住在生产 `src/` 里**,顶层 `import { afterEach, beforeEach } from "vitest"`,被 3 个 doctor 测试消费。它落在 `vitest.config.ts` coverage 的 `include: ["src/**/*.ts"]` 内(排除列表只排 `*.test.ts` / `*.d.ts` / `types*`),因此**计入 75% coverage 分母**,并且会被 tsup 的类型链带上 vitest 依赖。 |

### 5.4 packages/shared:无真死码

从 `src/index.ts` 不可达的 13 个文件全部是 **tsup 的独立 build entry**(`node.ts`、`errors/index.ts`、`node/atomic-write.ts`、`node/mcp-payload-guard.ts`、`schemas/api-contracts.ts`、`templates/bootstrap-canonical.ts`、`theme.ts`)或其传递依赖;逐个核实 `detector.ts`(239 行)确实活着(`detectFramework` 被 `cli/src/scanner/forensic.ts` + 4 个 server doctor-cite-* 模块消费)、`serve-lock.ts` 被 server-http-experimental 消费、`hook-runtime-entry.ts` 是 `tsup.hook-runtime.config.ts` 的 entry。

### 5.5 测试 helper 清单(全 8 个)

| 文件 | 行为 | 消费者 |
|---|---|---|
| `packages/cli/__tests__/helpers/init-test-utils.ts` | `cpSync` fixture 树 + 调**已死的** `buildInitExecutionPlan`/`executeInitExecutionPlan` | 16 文件 |
| `packages/cli/__tests__/helpers/policy-fixture.ts` | 政策 fixture | 3 文件 |
| `packages/shared/test/helpers/test-wall.ts` | 真 `git init --bare` 假远端 + clone/push | 5 文件 |
| `packages/shared/test/helpers/git-worktree-fixture.ts` | 真 git 三仓 worktree | 2+ 文件 |
| `packages/shared/test/fixtures/project-context-matrix.ts` | 数据 fixture | — |
| `packages/server/src/services/doctor-test-helpers.ts` | **住在 src/ 的测试 helper**(见 5.3) | 3 文件 |
| `packages/cli/__tests__/fixtures/cocos-stub/assets/scripts/{Game,Network,Player}.ts` | fixture 内容 | — |

---

## Caveats / Not Found

- **没有实测任何运行时间**。§3 全部是静态特征推断;真实"最慢文件"排名需要 `vitest --reporter=verbose` 或 `--reporter=json` 的 duration,本次按要求未跑(主线在后台跑全量)。工作流文件里也没有 `timeout-minutes`,无法从配置读出历史时长。
- **§2.4 三档划分是我按"断言对象是不是自然语言/AI-facing 文案"划的,不是仓库里已有的分类。** 档 B/C 的多数用例在当前形态下是确定性的(不需要真 AI 参与就能跑绿),是否属于"需靠 AI 运行时验证"取决于口径松紧;我在该节末尾标出了严口径下真正符合的 4 个文件。
- **it/test 用例总数未逐文件统计**(只对 3 个巨型文件数了:doctor-cite-coverage 86、fabric-hint 146、knowledge-hint-broad 85)。
- `packages/server-http-experimental`(10 文件)`test` script 是 `echo skipped && exit 0`,行数已计入 305/73,401 总量但**不进任何 gate**;若只看 gate 内口径,应从各表扣掉这 10 个文件。
- `.trellis/spec/` 下未找到测试相关的 spec 文档(spec 目录只有 fabric-cli / fabric-server / fabric-server-http-experimental / fabric-shared / guides 五个包级目录);测试策略的权威文档是 `docs/TESTING.md` + `docs/methodology/*.md`(7 份),后者由 `scripts/test-strategy-gate.mjs` 强制其存在。
- `scripts/i18n-audit.mjs`、`build-hook-project-context.mjs`、`migrate-two-layer-stores.mjs` 在 package.json / workflows / lefthook / TESTING.md 中都无引用(orphan);`measure-injection.mjs` 被 `docs/TESTING.md` 提及但 `scripts/` 下**不存在该文件**(文档漂移,test-strategy-gate 没检查这一条)。
