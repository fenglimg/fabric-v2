# W2/W3 — 工程证据(实跑)

执行日期:2026-08-13。工作目录 `/Users/wepie/Desktop/personal-projects/pcf`,分支 `main`,版本 `2.5.0-rc.4`。

---

## §P1 — 门禁实跑结果(13 道)

跑法见 `/tmp/fabric-audit/run-gates.sh`,逐条日志在 `/tmp/fabric-audit/gate-*.log`。

| 门禁 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| build | `pnpm -r build` | 0 | ✅ |
| typecheck | `pnpm typecheck` | 0 | ✅ |
| typecheck:tests | `pnpm typecheck:tests` | 0 | ✅ |
| lint | `pnpm lint` (knip --strict) | 0 | ✅ |
| test | `pnpm test` | 0 | ✅ |
| test:strategy | `pnpm test:strategy` | 0 | ✅ |
| dangling-refs | `pnpm test:dangling-refs` | 0 | ✅ |
| doc-drift | `pnpm test:doc-drift` | 0 | ✅ |
| store-only-e2e | `pnpm test:store-only-e2e` | 0 | ✅ |
| upgrade-e2e | `pnpm test:upgrade-e2e` | 0 | ✅ |
| **nofake-audit** | `node scripts/nofake-audit.mjs` | **1** | ❌ **见 F-01** |
| red-team-safety | `node scripts/red-team-safety.mjs` | 0 | ✅ |
| perf-benchmark | `node scripts/perf-benchmark.mjs` | 0 | ✅ |

**P1 结论**:12/13 绿。测试总量 649(shared) + 1172(server) + 1489(cli) = **3310 个测试通过**。

---

## F-01 — `nofake-audit` 门禁自身失效(store 别名 vs 目录名)

**严重度:显著**

### 现象

```
valid KB ids (mounted stores):  232
cite/consume events:            53
distinct cited ids:             49
resolved (real):                28
fabricated (unresolvable):      25 (distinct 25)
    ✗ fabric-team:KT-PIT-0076
    ✗ fabric-team:KT-GLD-0019
    ...
self-test (synthetic fake flagged): ✓ caught
G-NOFAKE FAIL: 25 fabricated KB id(s) cited in real telemetry
```

### 根因(已验证,非推测)

[`scripts/nofake-audit.mjs:50`](scripts/nofake-audit.mjs:50) 用**目录名**拼有效 id:

```js
for (const group of readdirSync(STORES_ROOT)) { ...
  if (m) valid.add(`${group}:${m[1]}`);   // group = 目录名
```

而 [`scripts/nofake-audit.mjs:100-102`](scripts/nofake-audit.mjs:100) 用**别名**限定被引用 id:

```js
if (!qid.includes(":") && typeof row.store === "string" && row.store) {
  qid = `${row.store}:${qid}`;            // row.store = 别名
}
```

实测两者不等:

```
$ node -e '...buildValidIdSet()...'
built valid size: 232
has team:KT-PIT-0076        -> true
has fabric-team:KT-PIT-0076 -> false
```

`~/.fabric/fabric-global.json` 中该 store 是 `mount_name: fabric-team-knowledge` / **`alias: fabric-team`**,挂在 `~/.fabric/stores/**team**/` 下。目录名 `team` ≠ 别名 `fabric-team`。

**为什么只挂一部分**:`personal` store 的别名恰好等于其目录名(都是 `personal`),所以它的引用能解析 —— 那 28 条 "resolved" 就是它。凡是别名与目录名不同的 store,其**全部**引用被误判为 AI 幻觉。

被标的 25 个 id 全部**真实存在于磁盘**,例如
`~/.fabric/stores/team/fabric-team-knowledge/knowledge/projects/fabric-v2/pitfalls/KT-PIT-0076--idempotent-entry-once-ever-timestamp.md`。

### 为什么自测没发现

自测只有一个方向([`scripts/nofake-audit.mjs:132-133`](scripts/nofake-audit.mjs:132)):

```js
const SYNTHETIC_FAKE = "team:KT-DEC-9999-hallucinated";
const selfTestCatches = !validIds.has(SYNTHETIC_FAKE);
```

它只验证"**假 id 会被抓**"(假阴性方向),**从不验证"真 id 能解析"**(假阳性方向)。所以门禁在 100% 误报的状态下,自测照样打印 `✓ caught`。

这正是 `KT-GLD-0022` 记录的模式:静态门禁的口径必须逐轮收窄到 0 命中才能上线,否则等于没闸。

### 放大因素

`nofake-audit.mjs` **不在 package.json scripts、不在 CI workflow、不在 lefthook** —— 全仓无任何自动化调用方(见 §W3.4 普查)。`docs/TESTING.md:97` 把它列在"手动按需跑"表里,所以未接线是有意设计;但后果是**没有任何东西会发现它坏了**。它最后一次改动是 2026-07-12,已静默失效不明时长。

---

## §P2 — 门禁严格度探针

### W3.1 变异测试(核心探针)

判据来自 `KT-GLD-0019`:测试有没有价值,只认"把实现改错它会不会红"。

| # | 变异内容 | 目标文件 | 结果 | 说明 |
| --- | --- | --- | --- | --- |
| **M1** | 倒置 locality 分层:`SAME_FILE 100→25`、`SAME_PACKAGE 25→100` | `packages/server/src/services/plan-context-score-factors.ts:138,140` | **✅ 被杀** | 3 个测试红。断言注释写着 `same-file locality (100) must lead same-package (25)` —— 钉的是**标定意图**而非常量数值,正合 `KT-GLD-0019` 的规范 |
| **M2** | `GLOBAL_REF_PATTERN` 的 UUID 段校验掏成 `.+`(即 `/^.+:K[PT]-(MOD\|DEC\|GLD\|PIT\|PRO)-\d{4,}$/`) | `packages/shared/src/schemas/store-stable-id.ts:50-51` | **❌ 存活** | **3310 个测试全绿**(shared 649 / server 1172 / cli 1489)。已 rebuild shared dist 后复跑下游,排除 dist 陈旧造成的假存活 |
| **M3** | 向上锚点 `.git → .fabric`(`KT-DEC-0050` 明文警告的自我俘获缺陷) | `packages/shared/src/resolver/project-context-resolver.ts:57` | **⚠️ 被杀(但方式弱)** | 仅 `__tests__/hooks-runtime-generated.test.ts` 一个**字节级重生成快照**测试红;shared/server 全绿。还原后该测试转绿,确认非环境噪声 |
| **C1**(对照组) | `RECENCY_BOOST 25→26`(纯标定微调) | 同 M1 文件 | **✅ 如期存活** | 证明测试套件不是"改啥都红",M2 的存活是真信号 |

**还原确认**:每处变异后立即 `git checkout` + `pnpm --filter @fenglimg/fabric-shared build`;最终 `git status --porcelain packages/ scripts/` 输出为空。

**M2 的意义**:`GLOBAL_REF_PATTERN` 有真实生产调用方 `packages/shared/src/store/cross-store-lint.ts`,且存在测试文件 `packages/shared/src/schemas/store-contracts.test.ts` 引用它 —— 但显然只测了 happy path,没有一条断言"畸形 UUID 必须被拒"。跨 store 引用格式是知识寻址的基础契约,这条盲区允许任意字符串冒充合法 global_ref 而无人察觉。

**M3 的意义**:被杀 ≠ 被理解。字节快照测试只回答"生成物变了没",不回答"解析行为对不对"。同样的语义错误若发生在非生成路径,会直接存活。

### W3.2 基线债

`scripts/typecheck-tests-baseline.json` 内容为 **`{}`** —— 基线债已清零(对应 commit `22c51a3b` "清空 typecheck:tests 117 条基线债 (117→0)")。**这是一个明确的正面结果**:没有用豁免名单掏空 typecheck 门禁。

### W3.3 门禁自覆盖口径

`scripts/doc-drift-gate.mjs:36`:

```js
const SCANNED_FILES = ["README.md"];
```

**只扫 README.md 一个文件**。而仓库另有 8 份文档(`docs/ARCHITECTURE.md`、`USER-QUICKSTART.md`、`TESTING.md`、`RUNTIME-CONTRACTS.md`、`KNOWLEDGE-MATURITY.md`、`configuration.md`、`UPGRADE.md`、`RELEASE-NOTES.md`)+ `CLAUDE.md` / `AGENTS.md`,全部不在扫描范围。

**严重度:轻微**(名字 `doc-drift-gate` 相对实际口径 README-only 有夸大,但脚本头部注释诚实写明了它的起因是 README 版本号漂移)。

### W3.4 未接线脚本普查

用 node 全仓遍历(**未用 Bash grep** —— 本机 ugrep 有假阴性,见下方 W3-note):

| 脚本 | package.json | CI | lefthook | 真实调用方 |
| --- | --- | --- | --- | --- |
| `nofake-audit.mjs` | ✗ | ✗ | ✗ | 仅 `docs/TESTING.md` 文档提及 |
| `red-team-safety.mjs` | ✗ | ✗ | ✗ | 仅 `docs/TESTING.md` |
| `habit-funnel.mjs` | ✗ | ✗ | ✗ | 仅 `docs/TESTING.md` |
| `build-hook-project-context.mjs` | ✗ | ✗ | ✗ | **30 处**(`.claude/hooks/lib/*.cjs`、`.codex/hooks/lib/*.cjs` 等生成物)—— 已接线 |
| `migrate-two-layer-stores.mjs` | ✗ | ✗ | ✗ | `packages/shared/test/store/migrate-two-layer.test.ts` —— 有测试覆盖 |

前三个是**文档声明的手动工具**,非遗漏。但 F-01 证明:手动门禁不跑就会静默腐烂。

### W3.5 架构分层

```
✓ 无反向依赖 (shared 不引 cli/server, server 不引 cli)
```

三包边界干净,无循环依赖。**正面结果。**

### W3.6 发布稳定性

```
tag 总数: 83     rc 标签数: 68
```

- `v2.3.0` 一个版本烧掉 **17 个 rc**(2026-06-25 → 2026-07-17,约 3 周)。
- `v2.4.0` → `v2.4.1` 同日发布(2026-07-21),即当天热修。
- 当前 `v2.5.0-rc.4` 停在 2026-07-28,距审计日已 16 天。

**rc/正式 ≈ 68/15 ≈ 4.5 : 1**。这个比例说明"发布前验证不足、靠 rc 试错"是稳定模式而非偶发。

### W3.7 依赖面

| 包 | dependencies | optionalDependencies | engines |
| --- | --- | --- | --- |
| shared | **1**(`zod`) | — | node >= 20 |
| server | 4(`@fenglimg/fabric-shared`、`@modelcontextprotocol/sdk`、`minimatch`、`zod`) | `fastembed@^2.0.0` | node >= 20 |
| cli | 8(`@clack/prompts`、`citty`、`string-width`、3 个 tree-sitter、2 个内部包) | — | node >= 20 |

**依赖面极为克制,是本次审计中最强的正面项。** `fastembed` 正确地放在 optionalDependencies(呼应 `KT-MOD-0003`:向量通道缺失时退回纯 BM25,零行为变化)。

tree-sitter 三包有唯一真实调用方 `packages/cli/src/scanner/forensic.ts`,非死重。

---

## W3-note — 工具可靠性实证

本次审计中 Bash `grep` 再次出现假阴性:

```
$ grep -nE "git|fabric|ANCHOR|anchor|marker" packages/shared/src/resolver/project-root-resolver.ts
(无输出)
```

而该文件确实含 `fabric` 字样(第 1-2 行注释)。改用 node `readFileSync` + 正则后正常。**所有普查类结论均以 node 脚本或 Read 工具取得**,未采信 Bash grep 的空结果。

---

## UNVERIFIED(本次未能验证的项)

- **CI 真实红绿历史**:未拉取 GitHub Actions run 历史,W3.6 的稳定性结论仅基于 tag 密度推断,未直接测量 CI 失败率。
- **变异测试覆盖面**:仅注入 3 处变异 + 1 对照,不构成统计意义上的变异得分。M2 存活证明存在盲区,但盲区总面积未知。
- **性能**:`perf-benchmark.mjs` 只跑通(exit 0),未读取其输出数值,未与历史基线对比。
- **red-team-safety 的实际覆盖**:门禁绿,但未审查它测了哪些攻击面(OWASP MCP Top 10 的 memory poisoning 是否在内,未知)。
