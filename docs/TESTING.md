# Fabric Testing

测试策略入口。**日常只读本页 Gate Map**；深方法论链到文末附录，不当合入教条。

## Authority

测试策略按 3 层读取：

1. **项目当前事实**：本文件、根 `package.json`、各 package `vitest.config.ts`、`.github/workflows/reusable-validate.yml`、`.github/workflows/ci.yml`。
2. **全面测试方法论**：[test-methodology-v6.md](./methodology/test-methodology-v6.md)。这是 v0→v6 多轮冷评、回测、human frame-challenge 后的 incumbent。
3. **Fabric E2E/dogfood 方法论**：[e2e-methodology-FINAL.md](./methodology/e2e-methodology-FINAL.md)。这是 v2.1 多 store 后的端到端旅程方法论。

方法论调研材料：

- [mainstream-research.md](./methodology/mainstream-research.md)：ISO 25010、HTSM、探索式测试、风险驱动、fitness functions、RAGAS、agent trajectory eval。
- [samespace-research.md](./methodology/samespace-research.md)：mem0/Letta/Zep、Braintrust/LangSmith/Langfuse、MCP Inspector。
- [trackd-research.md](./methodology/trackd-research.md)：OWASP LLM Top 10、LLM/agent 红队、成本和 loop 失控防护。
- [backtest-answer-set.md](./methodology/backtest-answer-set.md)：confirmed/refuted 回测答案集。
- [discovery-rubric.md](./methodology/discovery-rubric.md)：发现力评分规约。

## Commands

根目录：

| 命令 | 用途 |
| --- | --- |
| `pnpm -r build` | 构建（E2E / typecheck 前置） |
| `pnpm -r test` | 包级 vitest |
| `pnpm -r --if-present test:coverage` | 带 coverage 门槛 |
| `pnpm typecheck` | 全仓 `tsc --noEmit` —— **只覆盖 `src/`** |
| `pnpm typecheck:tests` | `src/` **外**的测试文件类型检查(棘轮,见下) |
| `pnpm lint` | knip |
| `pnpm test:strategy` | 本文件 ↔ scripts ↔ CI 锚点 |
| `pnpm test:store-only-e2e` | 装/绑/写/审/召回黑盒（需先 build） |
| `pnpm test:upgrade-e2e` | install 升级刷新 stale hook/skill（需先 build） |
| `pnpm test:dangling-refs` | 散文/注释引用的仓内路径是否还存在 |

包级脚本见各 `package.json`。

## Gate Map

### PR hard（每次合入）

与 `.github/workflows/reusable-validate.yml` 对齐：

1. `pnpm -r build`
2. `pnpm -r exec tsc --noEmit`
2b. `pnpm typecheck:tests`（棘轮，见下）
3. `pnpm lint`
4. `pnpm -r --if-present test:coverage`
5. `pnpm test:strategy`
6. `pnpm test:store-only-e2e`
7. `pnpm test:upgrade-e2e`
8. `node --experimental-strip-types scripts/lint-protected-tokens.ts`
9. `pnpm test:dangling-refs`
10. `node scripts/perf-benchmark.mjs`

> **T-4:曾经的第 9 步「`NO_COLOR=1` + scoped reskin/i18n 快照」已删。** 那 4 个快照文件
> 自身就 stub 了 `NO_COLOR`(`vi.stubEnv` / 直接赋值),实测在 `NO_COLOR` 未设与
> `FORCE_COLOR=1` 两种环境下结果完全一致 —— 该步是第 4 步覆盖率跑的纯重复。
> 删除依赖「文件自身 stub」这一不变量,该不变量现由 `test:strategy` 强制:任一文件
> 停止 stub `NO_COLOR`,门禁直接红。

Windows smoke（`ci.yml`）：shared 合同面 + 已构建 CLI `--help` / `--version`，不替代 Linux 全量。

### Release hard

`.github/workflows/release.yml` **先** `uses: reusable-validate.yml`（`verify_tag: true`），**再** publish。  
**PR 与 Release 同一套确定性门禁**——发版不得更松。

### Optional (not PR hard)

**什么该进这一档:断言的是「结构/契约」还是「措辞/文案」。**

一条断言只要点名了 code-level 标识符 —— MCP 工具名、config key、marker 字面量、
枚举值、文件路径 —— 它守的就是 prompt 与代码面之间的契约,**留在门禁**:这类断言
变红意味着 prompt 在教一个不存在的东西。反之,断言引用的是散文 —— 标题、句子、
章节先后、字节数下限 —— 它量的是 prompt 写得好不好,**移出门禁**:把散文锁进门禁,
每次改进 prompt 都会假红(单元测试的输出是布尔,eval 的输出是分数;是分数的不进门禁)。

落地方式:同名 `*.wording.test.ts` 兄弟文件 + `describe.runIf(process.env.PROMPT_WORDING === "1")`,
断言保留不删,只是改成按需跑。现有两个:
`packages/shared/test/templates/bootstrap-canonical.wording.test.ts`(bootstrap 正文)、
`packages/cli/__tests__/fabric-hint.wording.test.ts`(Stop hook banner 措辞)。

**留在门禁的那一半怎么写。** hook banner 的中文由 `templates/hooks/lib/banner-i18n.cjs`
的 catalog 集中渲染,所以「哪条分支触发了」应当断言 `renderBanner("<key>", ...)` 的返回值
而不是手抄一段中文 —— 前者钉的是 catalog key(契约),改文案时两侧自动同步;后者是文案副本,
改一次文案要追着改测试。数量类断言(命中数 / 阈值 / 比例)只断言**算出来的值**
(`/\b20\b/`、`/3\/10/`),别把它包在中文框架句里。

| 命令 / 脚本 | 何时跑 |
| --- | --- |
| `scripts/habit-funnel.mjs` | 看真实 dogfood 习惯漏斗是否「活着」 |
| `scripts/nofake-audit.mjs` | 真实 cite 是否幻觉 id |
| `DOGFOOD_BASELINE=1` + recall dogfood baseline | 调排序质量时 |
| `PROMPT_WORDING=1` + `*.wording.test.ts` | 有意重写 prompt 正文时(措辞/排序/篇幅断言) |
| `scripts/red-team-safety.mjs` | 安全对抗（注意脚本路径可复现性） |
| 人工 dogfood 清单 | 里程碑 / 发版前抽检，不当主 CI |

## Package Boundaries

| 包 | 测试位置（实测文件数） | coverage 线（约） |
| --- | --- | --- |
| `@fenglimg/fabric-cli` | `__tests__/` 144，`src/` 内 0 | 70% |
| `@fenglimg/fabric-server` | `src/**/*.test.ts` 94、`__tests__/` 8 | 75% |
| `@fenglimg/fabric-shared` | `test/` 45、`src/**/*.test.ts` 9 | 85% |

### 三包布局为什么不统一（刻意保留的差异）

三包用**同一份** tsconfig 形状（`rootDir: ./src` + `include: ["src/**/*.ts"]`，无任何测试专用
tsconfig，vitest 也没开 `typecheck`）。由此有一条**从未被写下来的后果**：

> **只有共址在 `src/` 里的测试进 `tsc --noEmit`。`src/` 外的 197 个测试文件
> （cli 144 + shared 45 + server 8）不被任何 tsconfig 类型检查。**

这不是推断,是构造式探针测出来的:同一行 `const x: number = "…"` 放进
`packages/cli/__tests__/` → `tsc` 退出 0（漏掉）;放进 `packages/server/src/services/` →
`tsc` 退出 1 报 TS2322（抓到）。两条断言都成立才算数。

所以「共址 vs 独立目录」不是排版口味,是**这批测试有没有类型覆盖**的选择:

- **server 共址(94/102)** —— 服务层测试大量断言包内私有符号,共址后既能直接相对
  import,又整体落进 `tsc` 的检查面。KT-PIT-0080 论证过这是 `rootDir` 约束下的正确
  选择,不是待修的漂移。
- **cli 全外置(144/144)** —— cli 测的是命令行为与安装产物,断言面是 stdout / 文件树 /
  快照,不需要包内私有符号;换来的是 `__tests__/` 与 fixture 树放在一起。代价是这
  144 个文件的类型错误只能等 vitest 运行时炸,不会在 `tsc` 阶段拦下。
- **shared 混合(9 共址 / 45 外置)** —— 那 9 个共址的全部是**契约/普查型**测试
  (`event-ledger.test.ts`、`store-contracts.test.ts`、`knowledge-enum-census.test.ts`、
  `locale-parity.test.ts` 等),它们直接对着 zod schema 与 i18n 表断言,类型层被检查
  的价值最高。这 9 个是有理由的例外,不是遗留。

**结论:不统一。** 统一的收益是观感,代价是要么把 144 个 cli 测试搬进 `src/`(污染
发布面 + 撑大 `rootDir`),要么把 94 个 server 测试搬出去(丢掉类型覆盖)。两条都比
现状差。**该动的是给测试加一份 tsconfig 把那 197 个文件纳入检查,而不是搬目录。**

### 测试类型检查棘轮(`pnpm typecheck:tests`)

上面那条已落地:三个包各有一份 `tsconfig.test.json`(`extends` 本包配置,解除
`rootDir`、`noEmit`、按 vitest 的 bundler 语义解析模块),由
`scripts/typecheck-tests.mjs` 驱动。

**它是棘轮不是普通门禁。** 首次运行报出 **29 个文件 / 120 个既存错误** ——
直接挂红会变成没人保持绿的门禁(`lint-dangling-refs.mjs` 为自己 1445 命中的
第一版记过同样的账);挂成建议又会变成没人看的门禁。所以规则是:

- **不在基线里的文件必须零错误** → 新写的测试从第一天起就被检查。
- **基线里的文件只能变少,不能变多** → 既存债只能还,不能加。
- 还完债跑 `node scripts/typecheck-tests.mjs --update-baseline` 锁定收益。
  **调高基线数字是非法的**,脚本会拒绝。

基线在 `scripts/typecheck-tests-baseline.json`。⚠️ **不要用 `as any` 消错** ——
那比不检查更糟:它让门禁变绿的同时把类型信息也删了。

门禁自身经三条构造式断言验证会红:① 新增带错的测试文件 → `NEW`;
② 基线文件错误数 +1 → `WORSE`;③ 两者还原 → `PASS`。

**首次运行的实际收获**:`banner-i18n.test.ts` 里一个 `enMustNotContain` 契约字段,
声明了 `ISS-20260712-017` 的回归意图却**没有任何断言消费它**。(该保护本身没失守
—— 同文件的 `expect(out).not.toMatch(/[一-鿿]/)` 是更强的整类字符断言,已覆盖;
死的是这个冗余字段。)这类东西测试全绿时永远看不见。

## Do not

| 不做 | 原因 |
| --- | --- |
| 无 validate CI | 发布物进用户环境；确定性回归必须硬拦 |
| 对话式 UAT 当主质量体系 | 人不可规模化；适合抽检，不适合 PR/发版主闸 |
| 整包 maestro-flow auto-test 流水线 | 测业务项目，不是知识层产品 |
| PR 强制真 LLM / 真 `~/.fabric` 全扫 | 贵、抖；放 optional |
| 用 coverage% 顶替 round-trip / store-only | 线覆盖不是 producer→consumer oracle |
| 再写平行总方法论 | v6 + e2e-FINAL 已是附录权威 |

## Drift Gates（轻）

- 本文件 ↔ root scripts ↔ `reusable-validate` / `ci.yml`：`pnpm test:strategy`
- CLI surface snapshot、schema、tool 注册、bootstrap、protected-token：见包测

策略 gate **只保证入口与 CI 不漂**，不评判覆盖质量。

## 变更时最少跑什么

| 变更类型 | 最少命令 |
| --- | --- |
| 纯 shared 契约 | `pnpm --filter @fenglimg/fabric-shared test` |
| server / MCP | `pnpm --filter @fenglimg/fabric-server test` |
| CLI / hook 文案 | `pnpm --filter @fenglimg/fabric-cli test`(reskin/i18n 快照文件自身 stub `NO_COLOR`,无需外部 env) |
| store 旅程 / install | `pnpm -r build && pnpm test:store-only-e2e`（升级路径再加 `test:upgrade-e2e`） |
| 只改本文件或文档命令名 | `pnpm test:strategy` |

写行为 / 修 bug / 加 release 门禁时优先 write-red（先失败断言再实现）。文档-only 可跳过 red，但动到本文件命令名须跑 `test:strategy`。

## Appendix

1. [test-methodology-v6.md](methodology/test-methodology-v6.md) — 四赛道 × 认识论  
2. [e2e-methodology-FINAL.md](methodology/e2e-methodology-FINAL.md) — 旅程 / 交互轴 / T1–T3  
3. 调研材料：`docs/methodology/` 下的 `mainstream-research.md` / `samespace-research.md` / `trackd-research.md` / `backtest-answer-set.md` / `discovery-rubric.md`

Coverage 仍是下限信号；跨写读边界优先 round-trip / store-only 断言。  
