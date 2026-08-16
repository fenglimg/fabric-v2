# Design — worktree 身份解析改 local-first

## 1. 当前实现与它的失效

`packages/shared/src/resolver/` 三个文件构成解析链:

```
project-context-resolver.ts   createProjectContextResolver → resolveRoots
  └─ git-worktree-identity.ts resolveGitWorktreeIdentity   ← 缺陷在这
       └─ 判据: basename(commonDir) === ".git" ? dirname(commonDir) : workspaceRoot
```

失效点([git-worktree-identity.ts:39](../../../packages/shared/src/resolver/git-worktree-identity.ts)):

| git 布局 | commonDir | 现 identityRoot | 判定 |
| --- | --- | --- | --- |
| 普通仓 + linked worktree | `<main>/.git` | `<main>` | ✅ |
| bare `A/foo.git` + wt1/wt2 | `A/foo.git` | `A/wt1` / `A/wt2` | ❌ 身份碎片化 |
| `.bare` 约定(`C/.bare`) | `C/.bare` | `C/wt1` | ❌ 同上 |
| bare 位于 `B/.git` | `B/.git` | `B` | ❌ 指向非 checkout 容器 |

**这条路径不会抛错**:`commonDir` 存在 ⇒ `dirname(commonDir)` 必存在 ⇒ `canonical()` 不抛 ⇒ 永远返回一个「看起来合理」的错答案。这是它能在 3310 测试全绿下存活的原因之一(另一个原因见 §5)。

## 2. 新的解析顺序

核心变化:**identityRoot 不再被猜测**。它要么就是 workspaceRoot 自己,要么是 git 给出的权威答案。

```
resolveRoots(candidate):
    workspaceRoot ← git rev-parse --show-toplevel(candidate)
                    ?? findProjectMarker(candidate)          # 非 git 仓兜底
    if workspaceRoot is null → return null

    # ① local-first:本地有 config = 本 checkout 已安装
    if hasProjectConfig(workspaceRoot):
        return { workspaceRoot, identityRoot: workspaceRoot, identitySource: "local" }

    # ② fallback:向主 worktree 继承(仅当主 worktree 真实存在且已安装)
    main ← mainWorktreeFromGit(candidate)
    if main ≠ null and main ≠ workspaceRoot and hasProjectConfig(main):
        return { workspaceRoot, identityRoot: main, identitySource: "inherited" }

    # ③ 明确失败 —— 不编造
    return null
```

`mainWorktreeFromGit`:

```
records ← git worktree list --porcelain     # 空行分隔的记录块
first   ← records[0]
if first 含 "bare" 行 → return null         # bare 仓无主 checkout 可继承
return canonical(first.worktree 路径)
```

依据(实跑验证):`git worktree list --porcelain` 第一条恒为主 worktree,且从 linked worktree 内执行结果相同;bare 仓时第一条带独立的 `bare` 标记行。

## 3. 各布局下的新行为

| 布局 | 本地有 config? | 新 identityRoot | identitySource |
| --- | --- | --- | --- |
| 普通仓 | 有(tracked) | 自身 | `local` |
| 普通仓 + linked worktree | **有**(git checkout 带出) | 自身 | `local` |
| bare 托管 worktree | **有**(同上) | 自身 | `local` |
| `.bare` 约定 | **有**(同上) | 自身 | `local` |
| worktree 在早于 install 的分支 | 无 | 主 worktree | `inherited` |
| bare 仓 + 该 worktree 无 config | 无 | — | **明确失败 + 告警** |

关键结论:**前四行——也就是全部正常使用场景——都走 `local`,不碰任何继承逻辑。** B-11/B-12 描述的碎片化与幽灵目录不再可达。继承是冷路径。

## 4. 契约变更

### 4.1 `ProjectContext` 新增 `identitySource`

```ts
identitySource: "local" | "inherited"
```

消费方据此决定是否提示。`inherited` 不是错误,但值得在 `doctor` 里显示(「本 checkout 未安装,身份继承自 <main>」)。

### 4.2 `resolveGitWorktreeIdentity` 的去留

`identityRoot` 字段从该函数**移除**——它是缺陷所在。函数退化为纯粹的 git 事实读取(`workspaceRoot` / `gitDir` / `commonDir`),或直接被 `mainWorktreeFromGit` 取代。

调用方 [store-project-onboarding.ts:64](../../../packages/cli/src/install/store-project-onboarding.ts) 有一行:

```ts
const identityRoot = resolveGitWorktreeIdentity(projectRoot)?.identityRoot ?? projectRoot;
ensureProjectId(identityRoot, options.uuid);
```

`fabric install` 因此会把 config 写进**主仓库**而不是当前目录。改为 local-first 后应写入 `projectRoot` 自身。这是 D3 的直接推论,也顺带修掉「在 worktree 里 install 却弄脏另一个 checkout」的行为。

### 4.3 `workspace_binding_id` 的每-worktree 覆盖变成死代码

[bindings.ts:73](../../../packages/shared/src/store/bindings.ts) `resolveBindingIdForRoots`:

```ts
if (workspaceRoot === identityRoot) return resolveWorkspaceBindingId(identityConfig);
const workspaceConfig = loadProjectConfig(workspaceRoot);
return workspaceConfig?.workspace_binding_id ?? …   // ← 这一项
```

local-first 下 `identityRoot ≠ workspaceRoot` 仅在**继承**时成立,而继承的前提正是 `workspaceRoot` 没有 config ⇒ `workspaceConfig` 恒为 `null` ⇒ 首项恒 undefined。

**所以这条 per-worktree 覆盖分支在新模型下不可达。** 与 D4(不支持 worktree 当独立项目)方向一致。处理:删除该分支,并删除/改写 fixture 里对应的 `configureLinkedBinding("isolated")` 用例——否则它会变成一条测试自己制造前提、永远绿的空壳断言。

> 注意:`workspace_binding_id` 作为**身份 config 自身**的字段仍然有效(一个仓库可以让 binding id ≠ project_id)。被删的只是「worktree 本地覆盖」这一支。

## 5. 为什么现有测试抓不住

两层原因,都要在 R4 里堵掉:

1. **fixture 只造一种布局**([git-worktree-fixture.ts](../../../packages/shared/test/helpers/git-worktree-fixture.ts))。7 条 matrix 用例 `identityRoot` 全为 `"main"`,bare 系布局从未进入测试。
2. **fixture 人为制造了被测前提**——`git worktree add` 之后 `rmSync(join(linked, ".fabric"))`。真实 worktree 自带 tracked 的 config;删掉它才逼出「必须从 common dir 继承」。**测试在验证一个自己造出来的世界。**

因此新用例必须**先在旧实现下跑红**再改实现,否则无法区分「用例有效」与「用例恰好也通过」。

## 6. 告警设计(R3)

遵循 `KT-DEC-0075`(退化须响亮告警不静默)。该决策原文只约束 projectRoot 轴,本设计将 identityRoot 轴纳入同一约束——这是**推广既有决策,不是新立一条**。

- resolver 层:抛带可执行信息的 `ProjectContextUnresolvedError`(含 workspaceRoot、尝试过的继承源、下一步命令)。
- server 层:[project-context-provider.ts:52](../../../packages/server/src/project-context-provider.ts) `fallbackContext` 目前无声把 `identityRoot` 钉成 `workspaceRoot`,须改为沿用既有三面告警(startup log / initialize instructions / tool `warnings[]`)。
- hook 层(`.cjs`):hooks 原生拿得到 `CLAUDE_PROJECT_DIR`,且 `KT-DEC-0007` 要求 hook 不得成为硬门禁——此处只做**软提示**,不阻断。

## 7. 分层判据(R5)

写进 `.trellis/spec/`,两条:

**物件层——看「正确版本」由谁决定:**

| 由谁决定 | 归属 | 实例 |
| --- | --- | --- |
| 机器上装的 Fabric 版本 | 全局 | hooks / skills / templates |
| 这个仓库 | 项目 | 身份、绑定、启用开关 |
| 知识库自己 | store | corpus 参数 |

这是 `KT-MOD-0004`(配置 key 单一归属:身份归 project、偏好归 global、知识库属性归 store)从 **key** 到 **物件** 的推广,文档须显式声明这层关系,避免读者当成两套并行规则。

**数据层——看天然聚合边界:** 按 repo 聚合 → 项目;按人聚合 → 全局;按 session 聚合 → 两边都不该长期堆积(需 TTL 或随 session 生命周期回收)。`KT-MOD-0004` 不覆盖数据层,这条是补空。

按此判据,`fabric install` 写进项目的 138 个副本(40+40 hooks、29+29 skills,源 71 份)**归属应为全局**,但 D5 决定本轮不搬——判据先立,搬家另议。理由是客户端 hook 配置只认仓库相对路径(`${CLAUDE_PROJECT_DIR}/.claude/hooks/*.cjs`),搬家需引入 shim 间接层,会放大「全局 CLI 遮蔽本地源码」对本项目开发环路的干扰。

## 8. 影响面

| 文件 | 变更 |
| --- | --- |
| `packages/shared/src/resolver/git-worktree-identity.ts` | 删 identityRoot 猜测;新增/改为 `mainWorktreeFromGit` |
| `packages/shared/src/resolver/project-context-resolver.ts` | `resolveRoots` 改 local-first 三段 |
| `packages/shared/src/resolver/contracts.ts` | `ProjectContext` 加 `identitySource` |
| `packages/shared/src/store/bindings.ts` | 删不可达的 per-worktree 覆盖分支 |
| `packages/cli/src/install/store-project-onboarding.ts` | install 写入 `projectRoot` 自身 |
| `packages/server/src/project-context-provider.ts` | `fallbackContext` 静默钉死改告警 |
| `packages/shared/test/helpers/git-worktree-fixture.ts` | 支持 4 种布局;删/改 isolated 用例 |
| `packages/shared/test/fixtures/project-context-matrix.ts` | 扩 matrix 覆盖新布局与 `identitySource` |
| `.trellis/spec/` | 新增分层判据文档 |

⚠️ 改 `shared` 后必须 `pnpm --filter @fenglimg/fabric-shared build`,否则跨包 typecheck 读到陈旧 `dist/*.d.ts`。

## 9. 未决

- **R6 两个清理项**归属未定:`.fabric/.cache/` per-session 累积(TTL? 随 session 回收? 挪全局?)、`forensic.json` 是否停止 tracked。实施阶段各自给结论,允许结论是「显式不改 + 理由」。
- **分支污染**:从 worktree 跑 `fabric install` 后 config 落在该分支,主分支需合并才有。倾向只做文档提示,不加机制——待实施时确认。
