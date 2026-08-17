# Follow-up Backlog

审计只登记不修(PRD R6)。是否开任务由用户决定。

| # | 严重度 | 条目 | 影响面 | 预估 |
| --- | --- | --- | --- | --- |
| B-01 | 显著 | `scripts/nofake-audit.mjs:50` 用 store 目录名拼有效 id,遥测用别名 → 别名≠目录名的 store 全部误报。修法:有效集同时索引两种键(从 `~/.fabric/fabric-global.json` 读 alias↔mount 映射) | 反幻觉门禁完全失效 | 小(约 20 行) |
| B-02 | 显著 | `nofake-audit` 自测只验假阴性方向。补一条反向自测:随机取一个真实存在的 id,必须 `resolved`,否则 FAIL | 该门禁未来任何同类失效仍无法被发现 | 小 |
| B-03 | 显著 | `GLOBAL_REF_PATTERN` 无负向断言:掏成 `.+` 后 3310 测试全绿。补畸形 UUID / 缺段 / 大小写错误的拒绝用例 | 跨 store 寻址基础契约 | 小 |
| B-04 | 显著 | 产品层:对"保证 vs 建议"无对外说法。要么提供可选硬阻断模式(默认关),要么在 README 明确论证为何不做 | 竞争定位;`KT-DEC-0007` 需要一个对外版本 | 中 |
| B-05 | 显著 | 首价值闭环缺失(`KT-DEC-0072` 自列 D2 待办):装完无命中感知 | 决定 Fabric 能否被作者以外的人用起来 | 中 |
| B-06 | 显著 | 发布链路 rc:正式 = 4.5:1。**先测量再动手** —— 拉 CI run 历史算真实失败率与失败类型分布,再决定加什么门禁 | 发布效率 | 中 |
| B-07 | 轻微 | `doc-drift-gate` 只扫 README.md。扩到 `docs/` 8 份文档,或改名为 `readme-drift-gate` 以名实相符 | 文档漂移防护 | 小 |
| B-08 | 轻微 | `.git` 锚点等语义正确性只被字节快照测试保护。补一条行为断言(给定嵌套 `.fabric` 残留,resolveProjectRoot 必须仍锚到 `.git`) | 同类语义错误在非生成路径会存活 | 小 |
| B-09 | 轻微 | README 无诚实对标节。补 Basic Memory / Mneme HQ 的横向对比 | 对外可信度 | 小 |
| B-10 | 待验证 | `red-team-safety.mjs` 门禁绿,但未审查覆盖了哪些攻击面。OWASP MCP Top 10 的 memory poisoning 是否在内,未知 | 安全 | 小(先只做审查) |
| B-11 | 显著 | `git-worktree-identity.ts:39` 用 `basename(commonDir) === ".git"` 认主仓库。**bare-repo 托管的 worktree 布局下该判据不成立**,identityRoot 静默退化成 workspaceRoot → 同一仓库的每个 worktree 各自成为独立 Fabric 项目(各自 `project_id` UUID、各自 binding、各自快照)。实测见下方 B-11/B-12 复现 | 共享身份保证失效;多 worktree 用户知识割裂 | 中 |
| B-12 | 显著 | 同一判据的反向失效:bare repo 恰好位于 `<container>/.git` 时,identityRoot = `<container>` —— 一个**根本不是 checkout 的目录**。`ensureProjectId` / `storeBind` / `regenerateBindingsSnapshot` 全部写进该容器目录,文件从任何 worktree 都看不见、不受版本控制、重整目录即丢 | 身份配置写到"不存在的主仓库" | 中 |
| B-13 | 显著 | 上述两条退化**零告警**,违反 `KT-DEC-0075`(退化须大声告警不得静默)。该决策只覆盖了 projectRoot 轴,identityRoot 轴同样会静默塌缩却无三面告警;`project-context-provider.ts:52-65` 的 `fallbackContext` 也无声把 identityRoot 钉成 workspaceRoot | 与既有 fail-loud 决策不一致;故障可长期潜伏 | 小(先只加告警) |
| B-14 | 轻微 | `test/helpers/git-worktree-fixture.ts` 只造"普通仓 + linked worktree"一种布局,7 条 matrix 用例全部 `identityRoot: "main"`。缺 bare-repo 托管布局的用例,所以 B-11/B-12 在 3310 测试全绿下存活 | 测试广度盲区(census 未做) | 小 |

> **B-11 ~ B-14 去向**:已由设计讨论收敛,承接任务 `.trellis/tasks/08-17-worktree-identity-local-first/`。
> 结论是解析改 local-first(本地 config 优先,主项目继承降为冷路径 fallback),而非在现有 main-first 判据上打补丁 ——
> 因为 `fabric-config.json` 是 tracked 的,git 本身已在向每个 worktree 分发身份。下表的错误行在 local-first 下不再可达。

### 处置(2026-08-17 已实施并合入)

| 条目 | 处置 | 备注 |
| --- | --- | --- |
| B-11 | **已修 + 严重度下调** | 见下方更正。碎片化的实际触发面比原文小得多 |
| B-12 | 已修 | `resolveMainWorktree` 改问 `git worktree list --porcelain`,bare 记录直接返回 null,不再有"指向非 checkout 容器"这条路径 |
| B-13 | 已修 | `ProjectContext` 新增 `identitySource: "local" \| "inherited"`;无从继承时抛带下一步命令的 `ProjectContextUnresolvedError`,不再静默钉死 |
| B-14 | 已修 | 新增 4 种 git 布局的 fixture(normal-linked / bare-named / bare-dotbare / bare-as-dotgit)+ 14 条用例,并做了变异测试确认断言真能杀 bug |

> **更正:B-11 的严重度我报重了。** 原文写"同一仓库的每个 worktree 各自成为独立 Fabric 项目(各自 `project_id` UUID)"。
> 实测(在旧实现下跑新用例)10 条里只红了 3 条:`bare-named` 与 `bare-dotbare` 是**恰好通过**的 ——
> 因为 `fabric-config.json` 是 tracked 的,每个 worktree 都带着同一个 `project_id`,
> 于是"退化成 workspaceRoot"这个错误答案与正确答案**取值恰好重合**。
> 真正会出错的是 B-12 那条(identityRoot 指向容器目录)以及本地无 config 的冷路径。
> 这条更正本身就是原审计的教训:**推断出的失效路径要跑一遍再定级**。

## B-11 / B-12 复现(已实跑,证据)

```bash
T=$(mktemp -d); cd "$T"
# A: bare repo 名为 foo.git
git init -q --bare A/foo.git && git -C A/foo.git worktree add "$T/A/wt1" -b wt1
# B: bare repo 恰好位于 <container>/.git
mkdir -p B && git init -q --bare B/.git && git -C B/.git worktree add "$T/B/wt1" -b wt1
```

用 `resolveGitWorktreeIdentity` 实测输出:

| 布局 | commonDir | workspaceRoot | identityRoot | 判定 |
| --- | --- | --- | --- | --- |
| 普通仓 + linked worktree | `<main>/.git` | `<linked>` | `<main>` | ✅ 符合设计 |
| A `bare foo.git` + wt1/wt2 | `A/foo.git` | `A/wt1` / `A/wt2` | `A/wt1` / `A/wt2` | ❌ 身份碎片化(两个 worktree 互不相识) |
| C `.bare` 约定(`foo/.bare` + `foo/.git` 文件) | `C/.bare` | `C/wt1` | `C/wt1` | ❌ 同上 |
| B `bare` 位于 `B/.git` | `B/.git` | `B/wt1` | `B` | ❌ identityRoot 指向非 checkout 容器 |

注:`canonical(dirname(commonDir))` 永不抛错(commonDir 存在 ⇒ 其父目录必存在),所以这条路径**不会 fail,只会给错答案**。

## 本次审计未验证项(不是 backlog,是已知盲区)

- CI 真实红绿历史未拉取,B-06 的前提是推论。
- 变异测试只注入 3+1 处,不构成变异得分;盲区总面积未知。
- 竞品全部未实际安装试用。
- `perf-benchmark` 只跑通,未读数值、未对基线。
