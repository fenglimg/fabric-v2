# Implement — worktree 身份解析改 local-first

分支:先开 feature 分支再动手(不直接在 main 上改)。每个 Wave 收口即 commit。

```bash
git switch -c feat/worktree-identity-local-first
```

---

## Wave 0 — 先让新用例红(防等价变异)

**这一步必须在改任何实现代码之前完成。** 否则无法区分「用例有效」与「用例恰好也通过」。

- [ ] 0.1 扩 `packages/shared/test/helpers/git-worktree-fixture.ts`,支持 4 种布局:
  - `normal` 普通仓 + linked worktree(现有)
  - `bare-named` bare 仓 `foo.git` + 2 个 worktree
  - `bare-dotbare` `.bare` 约定(`C/.bare` + `C/.git` 文件)
  - `bare-as-dotgit` bare 仓位于 `<container>/.git`
  - fixture **不再** `rmSync` 掉 linked worktree 的 `.fabric/`(那是人为制造的前提);改为提供显式开关，只在测「继承」冷路径时才删
- [ ] 0.2 在 `project-context-matrix.ts` 加用例:每种布局断言 `identityRoot` 与新增的 `identitySource`
- [ ] 0.3 **实跑并记录红**:

  ```bash
  pnpm --filter @fenglimg/fabric-shared test -- project-context
  ```

  把失败输出摘录进 `research/` 或本文件末尾。bare 系三条必须红(现实现给错答案),`normal` 应绿。
- [ ] 0.4 commit(测试先行,允许红)

> 若某条新用例在**旧实现下就是绿的**,说明它没抓住缺陷 —— 回到 0.1 重新设计断言,不要放行。

---

## Wave 1 — 解析核心改 local-first

- [ ] 1.1 `contracts.ts`:`ProjectContext` 增 `identitySource: "local" | "inherited"`
- [ ] 1.2 `git-worktree-identity.ts`:
  - 删除 `basename(commonDir) === ".git" ? … : …` 判据与 `identityRoot` 字段
  - 新增 `mainWorktreeFromGit(start)`:解析 `git worktree list --porcelain`,取第一条记录;含 `bare` 行则返回 `null`
- [ ] 1.3 `project-context-resolver.ts`:`resolveRoots` 改三段(local → inherited → null),见 design §2
- [ ] 1.4 `bindings.ts`:删 `resolveBindingIdForRoots` 里不可达的 per-worktree 覆盖分支(design §4.3)
- [ ] 1.5 rebuild shared(否则跨包 typecheck 读陈旧 dist):

  ```bash
  pnpm --filter @fenglimg/fabric-shared build
  ```
- [ ] 1.6 Wave 0 的用例应转绿:

  ```bash
  pnpm --filter @fenglimg/fabric-shared test -- project-context
  ```
- [ ] 1.7 commit

---

## Wave 2 — 消费方对齐

- [ ] 2.1 `store-project-onboarding.ts`:`fabric install` 写入 `projectRoot` 自身,不再写主仓库(design §4.2)
- [ ] 2.2 `project-context-provider.ts`:`fallbackContext` 无声钉死 identityRoot 改为走既有三面告警(`KT-DEC-0075`)
- [ ] 2.3 hook 侧(`.cjs`)只做**软提示**,不阻断(`KT-DEC-0007`)
- [ ] 2.4 重新生成 hook runtime bundle(它由脚本从 shared 生成,不可手改):

  ```bash
  node scripts/build-hook-project-context.mjs
  ```

  确认 `packages/cli/templates/hooks/lib/project-context-runtime.cjs` 头部 `@generated` 声明仍成立
- [ ] 2.5 commit

---

## Wave 3 — 分层判据成文

- [ ] 3.1 在 `.trellis/spec/` 新增判据文档:物件层(正确版本由谁决定)+ 数据层(天然聚合边界)
- [ ] 3.2 显式写明与 `KT-MOD-0004` 的关系:**推广,不是另立**
- [ ] 3.3 记录 D5(138 副本不搬)的理由,供后来者查表而非重吵
- [ ] 3.4 commit

---

## Wave 4 — 两个附带清理(R6)

### 4a — 扩 doctor lint #27 的前缀集

清理机制**已存在**(lint #27 / `SESSION_HINTS_STALE_DAYS = 7`),缺的只是覆盖面。不要新造 TTL,不要接 SessionEnd 清理。

- [ ] 4a.1 **先写反向断言**:构造一个「看起来像 session 缓存但其实是测试夹具」的文件,断言它**不得**被清理。先跑,确认新断言在改动前是绿的(基线)
- [ ] 4a.2 `SESSION_HINTS_FILE_PREFIX` 单值 → 集合,纳入 `archive-hint-shown-`、`maintenance-hint-last-emit-`
- [ ] 4a.3 匹配条件收紧到三条**同时**成立:位于 `.fabric/.cache/` + 前缀命中 + 后缀为合法 session-uuid
- [ ] 4a.4 补正向用例:三类前缀各一条,超过 7 天必须被清
- [ ] 4a.5 4a.1 的反向断言仍绿

> ⚠️ `KT-PIT-0051`:`fabric doctor --fix` 曾在 worktree 中**两次误删测试夹具目录**。本步是同类动作,4a.1 的反向断言是防线,不可省略、不可后补。

### 4b — `forensic.json` 停止 tracked

- [ ] 4b.1 **前置检查(先做,不通过则不删)**:确认 `doctor-history.ts` / `knowledge-meta-builder.ts` 对 `forensic.json` 缺失是优雅降级。验证方式:临时移走该文件,跑 doctor 与相关测试,确认不炸
- [ ] 4b.2 `git rm --cached .fabric/forensic.json`
- [ ] 4b.3 写入 `.fabric/.gitignore`
- [ ] 4b.4 确认 `git status` 干净(不再出现 433 行 diff)

- [ ] 4.9 commit

---

## Wave 5 — 全量门禁与收口

- [ ] 5.1 本地 typecheck(**不能只信 build** —— rc.21/24/29 三次因此 CI 红):

  ```bash
  pnpm -r exec tsc --noEmit
  ```
- [ ] 5.2 全量:

  ```bash
  pnpm build && pnpm typecheck && pnpm typecheck:tests && pnpm lint && pnpm test
  ```
- [ ] 5.3 变异验证:把 `mainWorktreeFromGit` 的 `bare` 判定掏空,确认有测试转红(证明断言真在杀 bug,不是覆盖率好看)
- [ ] 5.4 回填审计任务 backlog:B-11 ~ B-14 标注去向(本任务承接 / 撤销 / 降级)
- [ ] 5.5 `trellis-check` → `trellis-update-spec` → commit

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
