# 收口记录 — 仓库门面整洁化

## 验收标准逐条(全部实测,非追述)

| # | 标准 | 判据结果 |
|---|---|---|
| A1 | `packages/cli/C:` 不再存在 | ✅ `test ! -e` PASS |
| A2 | 嵌套 `tmp/` 垃圾看得见 | ✅ 构造式探针两条断言:`packages/cli/__a2probe__/tmp/junk` 出现在 `git status`(1);根 `tmp/` 仍被忽略(1) |
| A3 | 顶层格位收敛 | ✅ 25 → **24**(删 `schemas/`) |
| A4 | `services/` 一眼可见 | ✅ 179 → **88**(阈值 ≤90) |
| A5 | 行为等价 | ✅ `tsc --noEmit` 退出 0;三包用例数**逐位相等**:shared 646/6、server 1159/2、cli 1473/5 |
| A6 | 门禁不倒退 | ✅ dangling-refs PASS;knip 仍是**基线那 2 条**(`tree-sitter-javascript` / `web-tree-sitter`),零新增 |
| A7 | 删除项经 rescue 检查 | ✅ 见下 |

## A7 · 每个删除项查过哪些消费者面

| 删除项 | 查过的消费者面 | 结论 |
|---|---|---|
| `packages/cli/C:`(160 文件 / 1.9M) | git 跟踪计数 = 0;被 `tmp/` 规则整片挡住 | 纯垃圾。**源头未修**:某个没处理 Windows 绝对路径的测试把 `C:\tmp\...` 当相对目录创建。本次只清症状 + 让复发可见 |
| `schemas/fabric-config.json` | zod schema(dual-truth 比对)、`scripts/`、`.github/workflows/`、`package.json` npm scripts、全仓 `String.includes` 普查 | 陈旧 dual-truth:只描述 43+ 字段中的 3 个,其中 `externalFixturePath` 已死,`$id` 是假的(未发布),零消费者。**删它是修 dual-truth,不是清理** |
| `src/services/__snapshots__/doctor-i18n.test.ts.snap` | 与迁移后新快照 `diff` | **逐字节相同**。新建快照会自动通过,只有比内容才算数 |

**未删、刻意保留**:`assets/brand/*.svg` 仓内 0 引用,但 GitHub 头像 / npm 页面 / 站点这类用途
**结构上不在仓内留痕**。按 KT-GLD-0016 rescue-before-delete,「查不到引用」不是死亡证明 —— 默认不删。

## R6 · `.trellis/` 跟踪面评估

实测 **110 个跟踪文件 / 787K**,分布:`spec` 42、`tasks` 30、`scripts` 28、其余 10。

**结论:有意保留,不做任何收缩。** 三条理由:

1. **它不抢产品格位。** 根目录里它只占 1 个点位(`.trellis/`),点开之前对读者零成本。
   本任务治的是「非产品的东西抢产品的格位」,`.trellis/` 不在此列。
2. **`scripts` 28 个是 Trellis 自己的运行时**,删了流程就跑不起来;`spec` 42 个是本仓
   spec 索引的真源,被 `get_context.py` 直接消费。
3. **`tasks` 30 个是决策档案。** 本任务的翻案(B10)之所以能做得干净,正是因为
   `08-10` 那轮的裁决与理由完整留在这里可以逐条对质。把它删薄等于让下一次翻案
   只能靠记忆。

## R3 · 本机残留 —— **未执行,需用户处置**

`rm -rf .cursor .antigravitycli .worktrees` 被权限分类器拦下,理由是 `.worktrees`
可能持有 live git worktree 状态(用 `rm -rf` 而非 `git worktree remove` 会损坏)。
**没有绕过。** 这一项本来就是「零仓库收益」——三者全在 `.gitignore` 里,别人克隆看不到。

留给用户的三项:

| 项 | 体量 | 性质 |
|---|---|---|
| `.cursor/` | 408K / 53 文件 | `trellis install` 产物,可重铺 |
| `.antigravitycli` / `.worktrees` | 0B(空目录) | 空壳,但 `.worktrees` 需用 `git worktree list` 确认后再动 |
| `tmp/`(535M) / `local_cache/`(91M) | 同类项目克隆 + 嵌入模型缓存 | **未动**。`tmp/` 里是 trellis / mem0 / spec-kit / OpenSpec 等设计对照读物,可能仍在用 |

## R5 · 三包测试布局 —— 裁决「不统一」,并测出一条从未被写下来的后果

写进了 `docs/TESTING.md` 的 Package Boundaries 小节。核心发现:

三包用**同一份** tsconfig 形状(`rootDir: ./src` + `include: ["src/**/*.ts"]`,
无测试专用 tsconfig,vitest 没开 `typecheck`)⇒ **只有共址在 `src/` 里的测试进
`tsc --noEmit`;`src/` 外的 197 个测试文件(cli 144 + shared 45 + server 8)
不被任何 tsconfig 类型检查。**

这不是读配置推断出来的,是**构造式探针**测的:同一行 `const x: number = "…"`
放进 `packages/cli/__tests__/` → `tsc` 退出 0(漏掉);放进
`packages/server/src/services/` → 退出 1 报 TS2322(抓到)。两条断言都成立。

**所以「共址 vs 独立目录」不是排版口味,是这批测试有没有类型覆盖的选择。**
统一的收益是观感,代价是要么污染发布面、要么丢掉 94 个 server 测试的类型覆盖,
两条都比现状差。真正该做的是**给测试加一份 tsconfig 把那 197 个文件纳入检查**
—— 那是独立的一件事,不是布局问题,本任务不顺手做。

## R4 · 迁移过程中值得留下的两条

1. **引用有两种形态,按语法找会漏掉字符串形态的同一引用。** 第一轮重写只覆盖
   `import` / `require` / 动态 `import`(152 处),漏掉 `vi.mock` / `vi.doMock` 的
   路径参数(7 处)→ 3 个测试文件 7 个用例红。补扫后加了一道**不依赖语法形态**的
   通用校验:扫全部相对模块路径字符串,报出解析不到的(现为 0)。
2. **门禁的 SKIP_SOURCE 是设计,不是遗漏。** `CHANGELOG.md` / `.workflow/issues/` /
   `.trellis/` 里指向已移动路径的引用**不改** —— 历史账本记录的是当时为真的事,
   一条命名了已删文件的关闭 issue 是正确的记录,不是烂引用。

## 遗留清单

| 项 | 状态 |
|---|---|
| `C:` 垃圾的**源头**(未处理 Windows 绝对路径的测试) | 未修,只清了症状 |
| `assets/brand/*.svg` 仓外用途 | 未向用户确认,默认保留 |
| 那 197 个不被类型检查的测试文件 | 已测出并写进 `docs/TESTING.md`,未修 |
| `packages/server/.ccw/.spec-index/*.json` 的删除 | 工作区里已删但仍被跟踪,**与本任务无关**,已撤出暂存区未提交 |
| knip 的 2 条既存未用依赖 | 基线就是红的,超出门面范围,未动 |
