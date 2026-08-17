# Implement — worktree 身份解析改 local-first

分支:先开 feature 分支再动手(不直接在 main 上改)。每个 Wave 收口即 commit。

```bash
git switch -c feat/worktree-identity-local-first
```

---

## Wave 0 — 先让新用例红(防等价变异)

**这一步必须在改任何实现代码之前完成。** 否则无法区分「用例有效」与「用例恰好也通过」。

- [x] 0.1 扩 `packages/shared/test/helpers/git-worktree-fixture.ts`,支持 4 种布局:
  - `normal` 普通仓 + linked worktree(现有)
  - `bare-named` bare 仓 `foo.git` + 2 个 worktree
  - `bare-dotbare` `.bare` 约定(`C/.bare` + `C/.git` 文件)
  - `bare-as-dotgit` bare 仓位于 `<container>/.git`
  - fixture **不再** `rmSync` 掉 linked worktree 的 `.fabric/`(那是人为制造的前提);改为提供显式开关，只在测「继承」冷路径时才删
- [x] 0.2 在 `project-context-matrix.ts` 加用例:每种布局断言 `identityRoot` 与新增的 `identitySource`
- [x] 0.3 **实跑并记录红**:

  ```bash
  pnpm --filter @fenglimg/fabric-shared test -- project-context
  ```

  把失败输出摘录进 `research/` 或本文件末尾。bare 系三条必须红(现实现给错答案),`normal` 应绿。
- [x] 0.4 commit(测试先行,允许红)

> 若某条新用例在**旧实现下就是绿的**,说明它没抓住缺陷 —— 回到 0.1 重新设计断言,不要放行。

---

## Wave 1 — 解析核心改 local-first

- [x] 1.1 `contracts.ts`:`ProjectContext` 增 `identitySource: "local" | "inherited"`
- [x] 1.2 `git-worktree-identity.ts`:
  - 删除 `basename(commonDir) === ".git" ? … : …` 判据与 `identityRoot` 字段
  - 新增 `mainWorktreeFromGit(start)`:解析 `git worktree list --porcelain`,取第一条记录;含 `bare` 行则返回 `null`
- [x] 1.3 `project-context-resolver.ts`:`resolveRoots` 改三段(local → inherited → null),见 design §2
- [x] 1.4 `bindings.ts`:删 `resolveBindingIdForRoots` 里不可达的 per-worktree 覆盖分支(design §4.3)
- [x] 1.5 rebuild shared(否则跨包 typecheck 读陈旧 dist):

  ```bash
  pnpm --filter @fenglimg/fabric-shared build
  ```
- [x] 1.6 Wave 0 的用例应转绿:

  ```bash
  pnpm --filter @fenglimg/fabric-shared test -- project-context
  ```
- [x] 1.7 commit

---

## Wave 2 — 消费方对齐

- [x] 2.1 `store-project-onboarding.ts`:`fabric install` 写入 `projectRoot` 自身,不再写主仓库(design §4.2)
- [x] 2.2 `project-context-provider.ts`:`fallbackContext` 无声钉死 identityRoot 改为走既有三面告警(`KT-DEC-0075`)
- [x] 2.3 hook 侧(`.cjs`)只做**软提示**,不阻断(`KT-DEC-0007`)
- [x] 2.4 重新生成 hook runtime bundle(它由脚本从 shared 生成,不可手改):

  ```bash
  node scripts/build-hook-project-context.mjs
  ```

  确认 `packages/cli/templates/hooks/lib/project-context-runtime.cjs` 头部 `@generated` 声明仍成立
- [x] 2.5 commit

---

## Wave 3 — 分层判据成文

- [x] 3.1 在 `.trellis/spec/` 新增判据文档:物件层(正确版本由谁决定)+ 数据层(天然聚合边界)
- [x] 3.2 显式写明与 `KT-MOD-0004` 的关系:**推广,不是另立**
- [x] 3.3 记录 D5(138 副本不搬)的理由,供后来者查表而非重吵
- [x] 3.4 commit

---

## Wave 4 — 两个附带清理(R6)

### 4a — 扩 doctor lint #27 的前缀集

清理机制**已存在**(lint #27 / `SESSION_HINTS_STALE_DAYS = 7`),缺的只是覆盖面。不要新造 TTL,不要接 SessionEnd 清理。

- [x] 4a.1 **先写反向断言**:构造一个「看起来像 session 缓存但其实是测试夹具」的文件,断言它**不得**被清理。先跑,确认新断言在改动前是绿的(基线)
- [x] 4a.2 `SESSION_HINTS_FILE_PREFIX` 单值 → 集合,纳入 `archive-hint-shown-`、`maintenance-hint-last-emit-`
- [x] 4a.3 匹配条件收紧到三条**同时**成立:位于 `.fabric/.cache/` + 前缀命中 + 后缀为合法 session-uuid
- [x] 4a.4 补正向用例:三类前缀各一条,超过 7 天必须被清
- [x] 4a.5 4a.1 的反向断言仍绿

> ⚠️ `KT-PIT-0051`:`fabric doctor --fix` 曾在 worktree 中**两次误删测试夹具目录**。本步是同类动作,4a.1 的反向断言是防线,不可省略、不可后补。

### 4b — `forensic.json` 停止 tracked

- [x] 4b.1 **前置检查(先做,不通过则不删)**:确认 `doctor-history.ts` / `knowledge-meta-builder.ts` 对 `forensic.json` 缺失是优雅降级。验证方式:临时移走该文件,跑 doctor 与相关测试,确认不炸
- [x] 4b.2 `git rm --cached .fabric/forensic.json`
- [x] 4b.3 写入 `.fabric/.gitignore`
- [x] 4b.4 确认 `git status` 干净(不再出现 433 行 diff)

- [x] 4.9 commit

---

## Wave 5 — 全量门禁与收口

- [x] 5.1 本地 typecheck(**不能只信 build** —— rc.21/24/29 三次因此 CI 红):

  ```bash
  pnpm -r exec tsc --noEmit
  ```
- [x] 5.2 全量:

  ```bash
  pnpm build && pnpm typecheck && pnpm typecheck:tests && pnpm lint && pnpm test
  ```
- [x] 5.3 变异验证:把 `mainWorktreeFromGit` 的 `bare` 判定掏空,确认有测试转红(证明断言真在杀 bug,不是覆盖率好看)
- [x] 5.4 回填审计任务 backlog:B-11 ~ B-14 标注去向(本任务承接 / 撤销 / 降级)
- [x] 5.5 `trellis-check` → `trellis-update-spec` → commit

---

## 已知假红(判定回归前先排除)

- **嵌套 worktree 存在时** `hooks-runtime-generated` 会假红:repo 遍历没排除 `.claude/worktrees/`,`package.json` 数两遍。CI 全绿。
- 在 `.claude/worktrees/` 内部跑 `knowledge-hint-*` / `fabric-hint-cite` 会有 21 个假失败(`detectClient` 路径启发误判 client=cc)。

## 提交注意

- 非交互 shell 提交撞 stdio-lint TTY 会静默失败,用:

  ```bash
  LEFTHOOK=0 git commit
  ```
- 改 CLI 命令名 / 删字段前,grep 范围必须含 `scripts/`、`.github/workflows/`、`package.json` 的 npm scripts。
- 本机 Bash `grep` 是 ugrep,correctness-critical 普查改用 Grep 工具或 node,别用 `\|` alternation。

---

## 实施与计划的偏差(收口记录)

1. **4a.3 的"合法 session-uuid"改为"非空 session token"**。写入侧
   (`session-signal-state.cjs`)把 session id 过一遍 `[^A-Za-z0-9_.-] → -` 的
   sanitiser 就落盘,并不保证是 UUID(Codex 的 identifier 形态不同)。要求 UUID
   会把合法 sidecar 排除在清理之外 → 反而漏。改为**照抄写入侧的字符类**并要求
   非空,判据来自 writer 而不是自己发明。
2. **4a.2 的前缀集比计划多一个**。普查真实 `.fabric/.cache/` 后发现漏的是三个
   家族不是两个:`hint-dismiss-*` 也从未被清扫。另外 `maintenance-hint-last-emit-*`
   **没有扩展名**,所以共享的 `.json` 后缀闸即使前缀命中也会跳过它 —— 数据结构
   因此从 `string[]` 改成 `{prefix, suffix}[]`。
3. **parity gate 本身也有同一个毛病**。`session-cache-prefix-parity.test.ts` 原来
   手抄了一张三项前缀清单去断言"这三项被清扫",在另外三个家族无限累积时一直绿。
   改为调真正的 writer helper 生成文件名再 round-trip。
4. **4b.1 的前置检查结论是"无需降级处理"**。`forensic.json` 缺失时 doctor 的
   既有行为就是报一条带下一步命令的 issue(`运行 fabric install 重新生成`),这
   正是 fresh clone 上该给的提示,不是需要被抹平的崩溃。同时把同性质的
   `install-manifest.json` 一并 gitignore(它本就未 tracked,只是一直在 `git status`
   里当噪声;若入库,别人的 `install_copy_drift` 基线会变成最后提交的人)。
5. **顺手删了 `doctor-core-checks.ts` 里三个重复常量**(两个死的
   `SESSION_HINTS_FILE_PREFIX/SUFFIX` + 一个重复的 `SESSION_HINTS_STALE_DAYS = 7`),
   守 `KT-MOD-0004` 的单一归属。
6. **5.3 变异验证跑了两处不是一处**。`bare` 守卫掏空后**全绿存活** —— 因为集成
   路径上 `hasProjectConfig` 对 bare 仓也会拒,双重把关。补了 `resolveMainWorktree`
   的直接契约断言后才转红(3 条)。local-first 顺序倒置的变异一次即红。

## check 阶段补修(trellis-check,同分支)

7. **submodule 布局漏在 census 外,补测即抓到一条真缺陷**。R1 明文要求「对所有 git
   布局成立」并点名 submodule,但 R4 的 fixture 只造了 4 种、都不含 submodule。补
   `submodule` 布局后 `resolveMainWorktree` 立即红:在 submodule 内
   `git worktree list --porcelain` 首条给的是**该 submodule 的 git dir**
   (`<super>/.git/modules/sub`)而**不是**它的工作树(git 2.52 实测)。那个路径
   存在,于是函数会返回一个「根本不是 checkout 的目录」—— 与被删掉的
   `basename(commonDir)` 启发**同一失效形状**,只是来源换成了 git 自己。
   生产上暂时无害(gitdir 里不会有 `fabric-config.json`,`hasProjectConfig` 会拒),
   但函数的声明契约("the repository's MAIN worktree")已被违反。
   **修法**:候选路径返回前必须自证是工作树 —— 用 `resolveGitWorktreeIdentity`
   确认它的 top level 就是自己,否则返回 null。教训:**"问权威工具"是必要不充分,
   工具的答案也要校验语义**(git 在 submodule 下用同一个 `worktree` 键表达 gitdir)。
8. **文档漂移**:`docs/ARCHITECTURE.md` 与 `docs/USER-QUICKSTART.md` 仍在描述
   「`identityRoot` 指向 Git common identity 对应的主工作树」和已被删除的
   per-worktree binding 覆盖分支。两处已按 local-first 改写(`doc-drift-gate` /
   `lint-dangling-refs` 均绿)。
9. **`identitySource` 原本零生产消费方 —— 追下去发现一条真误报**。design §4.1 说
   「消费方据此决定是否提示」,但实现完只有测试在读它。查消费方时发现
   `projectRootWarning` 把「有没有身份」key 在 `workspaceRoot` 上,而 local-first
   下二者恰好只在**继承冷路径**上不同 —— 那里 workspaceRoot 没有 config 但身份
   (以及 read-set)是真实继承到的。结果 5 个 MCP 工具会在每次调用都喊
   「team stores are NOT loaded」而它们其实是加载的。
   **修法**:检查改 key 在 `identityRoot`;继承路径给一条独立的、准确的、更轻的
   `project_identity_inherited`(带「在本 checkout 跑 `fabric install`」)。
   rootless spawn(`fallbackContext`,cwd=/)把 identityRoot 钉成 workspaceRoot,
   所以 KT-PIT-0046 那条原始告警照旧触发,没被这次改动削弱。
   教训:**一个新字段没有生产消费方时,别急着补消费方 —— 先问"本该读它的那段
   代码现在在读什么"**,答案往往就是 bug。
10. **另外三条小清理**:删掉 `resolveBindingIdForRoots` 已不起作用的第二个参数
    (留着等于邀请后人把删掉的分支再推导回来)、`git-layout-identity.test.ts` 的
    布局清单改从 `GIT_LAYOUT_KINDS` 派生(手抄清单会让"普查"悄悄不再是普查)、
    删 `scripts/lint-dangling-refs.mjs` 里对 `.fabric/forensic.json` 的 SKIP_SOURCE
    (该文件已 untracked,gate 读 `git ls-files`,这行已是死的)。

## 未做(显式留下,不是遗漏)

- **本 repo 自己 `.claude/hooks/lib/project-context-runtime.cjs` 是旧副本**,仍含
  `basename(commonDir)` 启发。属预期:安装副本不随源码改动更新,要重跑
  `fabric install` 才会刷新(`install_copy_drift` 会报)。不在本任务范围内动它,
  因为改它等于在本 worktree 里跑 install,会顺带改写两端 client 配置。
- **旧 `git-worktree-fixture.ts` 仍在 `rmSync` 掉 linked worktree 的 `.fabric/`**。
  Wave 0.1 原计划是给它加开关,实际做法是另写 `git-layout-fixture.ts`,旧的留作
  **冷路径**专用 fixture(它制造的正是继承前提,现在名副其实)。7 条 legacy matrix
  用例因此仍只覆盖冷路径 —— 正常路径由新 fixture 的 14 条覆盖,净覆盖不缺,但两个
  fixture 并存这件事本身值得后来者知道。
