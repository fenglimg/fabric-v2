# worktree 身份解析改 local-first + 全局/项目分层判据立规

## Goal

消除 Fabric 项目身份解析对「猜哪个是主仓库」的依赖。

今天 `resolveGitWorktreeIdentity` 用一行启发式判定主仓库(`basename(commonDir) === ".git"`),这条判据在 bare-repo 托管 worktree 的布局下不成立,且**不会失败、只会静默给错答案**。本任务把主次关系倒过来:**本地 config 优先(local-first)**,主项目继承降级为冷路径 fallback,fallback 改用 git 自己的权威答案。

同时把「一个物件该装到全局还是项目」的判据成文,避免以后每加一个物件重吵一轮。

## Background(已验证事实,非推测)

会话内实跑验证,四条:

1. `.fabric/fabric-config.json` **是 tracked 的**(`git ls-files .fabric/` 命中)。因此 `git worktree add` 会把它 checkout 进每个工作目录——**git 本身就是身份的分发机制**。
2. 实测两种布局(普通仓 / bare 仓托管)下,新建 worktree 都自带**同一个 `project_id`**。故 local-first 之后,B-11/B-12 在正常使用下不再触发。
3. `git worktree list --porcelain` 第一条恒为主 worktree,bare 仓时显式输出 `bare` 标记——这是权威答案,优于 basename 猜测。
4. 现有测试 fixture 是**人为 `rmSync` 掉 linked worktree 的 `.fabric/`** 才制造出「必须从 common dir 继承」这个需求的([git-worktree-fixture.ts:72](../../../packages/shared/test/helpers/git-worktree-fixture.ts))。真实场景该前提大多不成立。

缺陷登记详见审计任务 backlog 的 B-11 ~ B-14:
`.trellis/tasks/08-13-fabric-domain-and-engineering-audit/backlog.md`

## 已锁定的决策(用户在设计讨论中拍板)

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | `.fabric/fabric-config.json` **不允许 gitignore** | git 作为分发机制的前提;放弃它就必须另造全局 `path → project_id` 表 |
| D2 | worktree **不是新项目**,与主项目共享身份 | worktree 是同一代码库的另一分支 checkout;当新项目 = 把 B-11 缺陷升级成设计 |
| D3 | 解析改 **local-first**,主项目继承降为 fallback | 本地有 config 即视为已安装;倒过来后常见路径不再依赖任何猜测 |
| D4 | 「worktree 当独立新项目」**不支持**(选项 c) | 想要新项目就 clone 新仓库。支持它需引入未受版本控制的旁路 config,违反 `KT-MOD-0004`(一个 key 只能一处可写) |
| D5 | **不动** `fabric install` 写进项目的 138 个副本 | 成本高(install/uninstall/两端接线/drift 检查)、价值低(字节相同、已 gitignore、可重新生成)、风险实(全局 CLI 遮蔽本地源码会伤开发环路)。只立判据不搬家 |

## Requirements

### R1 解析改 local-first

- `createProjectContextResolver` 的身份来源顺序改为:**① workspace 本地 `.fabric/fabric-config.json` → ② fallback 继承主 worktree → ③ 明确失败**。
- 本地存在 config 即为「本 checkout 已安装」,不再向上/向外查找主仓库。
- 行为必须对**所有 git 布局**成立:普通仓、普通仓 + linked worktree、bare 仓托管 worktree、`.bare` 约定布局、submodule。

### R2 fallback 用 git 权威答案,不用 basename 猜测

- 删除 `basename(commonDir) === ".git"` 判据。
- fallback 改读 `git worktree list --porcelain` 第一条作为主 worktree。
- 识别 `bare` 标记:bare 仓没有主 checkout 可继承,此时**不得编造 identityRoot**。

### R3 退化必须大声,不得静默

- 遵守既有决策 `KT-DEC-0075`(退化须响亮告警不静默)。该决策原只覆盖 projectRoot 轴,本任务把 identityRoot 轴纳入同一约束。
- 拿不到可继承身份时,给出可执行的下一步(提示在本 checkout 跑 `fabric install`),而不是静默退回 workspaceRoot。
- [project-context-provider.ts:52](../../../packages/server/src/project-context-provider.ts) 的 `fallbackContext` 无声把 identityRoot 钉成 workspaceRoot,同样纳入整改。

### R4 测试补 bare 布局(修 census 盲区)

- 现有 fixture 只造一种布局,7 条 matrix 用例 `identityRoot` 全为 `"main"`,所以 B-11/B-12 在 3310 测试全绿下存活。
- fixture 必须能造出:普通仓 + linked worktree / bare 仓(`foo.git`)托管 / `.bare` 约定 / bare 位于 `<container>/.git`。
- 每种布局都要有断言。**修改前先让新用例在旧实现下红**,证明它抓得住(防等价变异)。

### R5 分层判据成文

- 把判据写进 `.trellis/spec/`:**看这个物件的「正确版本」由谁决定** —— 机器上装的 Fabric 版本 → 全局;这个仓库 → 项目;知识库自己 → store。
- 配置 key 层已有 `KT-MOD-0004`,本条是它向**物件**(文件、目录、可执行副本)的推广,需注明两者关系而非另立一套。
- 补一条**数据层**判据:看数据的天然聚合边界(按 repo / 按人 / 按 session),`KT-MOD-0004` 不覆盖这层。

### R6 两个附带清理

**R6a — doctor lint #27 的前缀覆盖缺口(不是"缺 TTL")**

> 更正:初次记录为「per-session 文件无限累积、无 TTL、无清理」,复测后**该前提不成立**。
> 体积上 124 个 `archive-hint-shown-*` 合计仅 **4774 字节**(`.cache/` 的 6.4M 中 4.3M 是 `vectors/`、1.0M 是 `bm25/`)。
> 机制上清理**早已存在**:[doctor-session-hints-stale.ts](../../../packages/server/src/services/doctor/doctor-session-hints-stale.ts),lint #27,`SESSION_HINTS_STALE_DAYS = 7`,带 apply-lint unlink 臂。

真实缺陷是覆盖面:`SESSION_HINTS_FILE_PREFIX = "session-hints-"` **只认一个前缀**。三类同性质文件(均为 per-session hint 去重标记、随会话结束失效)只清了一类:

| 前缀 | 实测数量 | 被 lint #27 清理 |
| --- | --- | --- |
| `session-hints-` | 13 | ✅ |
| `archive-hint-shown-` | 124 | ❌ |
| `maintenance-hint-last-emit-` | 4 | ❌ |

- 修法:把前缀集从单值扩成集合。**不新造 TTL 机制、不接 SessionEnd 清理**——既有机制方向正确,再加一套会造第二个真相源。
- ⚠️ **高风险动作**:`KT-PIT-0051` 记录了 `fabric doctor --fix` 在 worktree 中**两次误删测试夹具目录**。扩大 `--fix` 删除范围属同类动作,必须把匹配收紧到三条同时成立(位于 `.fabric/.cache/` + 前缀命中 + 后缀为合法 session-uuid),且**先补「夹具不得被删」反向断言再改实现**。

**R6b — `forensic.json` 停止 tracked**

- 决定性证据:该 tracked 文件含本机绝对路径 `"target": "/Users/wepie/Desktop/personal-projects/pcf"`,外加 `generated_at` 时间戳与 `generated_by: "fabric-cli@2.5.0-rc.4"`;当前工作区 diff 为 433 insertions / 37 deletions。
- 后果:任何第二位开发者 clone 到不同路径后生成的 `target` 必然不同 → 持续产生无意义冲突。机器生成产物不应进版本控制。
- 修法:`git rm --cached` + 写入 [.fabric/.gitignore](../../../.fabric/.gitignore)(该文件已在管 `events.jsonl` / `metrics.jsonl` / `.cache/`,同类归同处)。
- **前置检查(必须先做)**:消费方 `doctor-history.ts` / `knowledge-meta-builder.ts` 对文件缺失须为优雅降级而非假设存在——新 clone 的仓库首次运行不会有它。验证通过后才可删。

## 非目标

- 不搬迁 `fabric install` 写入项目的 138 个副本(D5)。
- 不引入全局 `path → project_id` 映射表(D1 使其不必要)。
- 不支持 worktree 作为独立项目(D4)。
- 不改知识库(store)侧任何布局。

## Acceptance Criteria

- [ ] R1:身份来源顺序为 local → 继承 → 明确失败,有测试钉住三段。
- [ ] R2:`basename(commonDir) === ".git"` 判据已从代码中删除;fallback 走 `git worktree list --porcelain` 且正确处理 `bare` 标记。
- [ ] R3:拿不到可继承身份时产生可观测告警(不是静默退回),`fallbackContext` 的无声钉死已整改。
- [ ] R4:fixture 覆盖 4 种 git 布局;新用例**在旧实现下先红后绿**的证据已记录(命令 + 输出)。
- [ ] R5:判据文档已落 `.trellis/spec/`,并显式说明与 `KT-MOD-0004` 的关系(推广而非另立)。
- [ ] R6:两个清理项各自有结论(修了 / 显式判定不修 + 理由),不留悬空。
- [ ] 全量门禁绿:`build` / `typecheck` / `typecheck:tests` / `lint` / `test`。
- [ ] 本地先跑 `pnpm -r exec tsc --noEmit`(历史上 rc.21/24/29 三次因只信 build 而 CI 红)。
- [ ] 审计任务 backlog 的 B-11 ~ B-14 已标注去向(本任务承接 / 撤销 / 降级)。

## Risks

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 体验回退 | worktree checkout 到早于 `fabric install` 的分支时,行为从「偷偷猜」变成「明确说没装」 | 已接受(诚实的空 > 静默的错);告警须给可执行下一步 |
| 分支污染 | 从 worktree 跑 `fabric install`,config 落在该分支上,主分支要等合并才有 | 设计阶段需给出说法,可能只是文档提示 |
| 假红 | 嵌套 worktree 存在时 `hooks-runtime-generated` 等测试会假红(已知历史现象) | 判定回归前先确认不是该已知现象 |
| 改 shared 不 rebuild | 改 shared schema 后不 build 会 runtime invalid union / 跨包 typecheck 读陈旧 dist | 改完跑 `pnpm --filter @fenglimg/fabric-shared build` |
