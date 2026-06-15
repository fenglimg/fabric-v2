# GOAL-BRIEF — Cursor client clean-slate 砍除 (mode① 计划-执行)

> 派生自 2026-06-15 release-eval grill 的 PREREQ。worktree=`pcf-cursor-cleanup`,分支 `chore/remove-cursor-support`(off main e22db30)。
> 关联:`[[project-fabric-scope]]`(2026-06-15 反转:supported clients 3端→2端 cc+codex);`[[feedback-clean-slate]]`(零用户,直接删不迁移)。

## 目标(一句话)
把 Cursor client 支持从 codebase **clean-slate 删净**,supported clients 收成 **Claude Code(cc)+ Codex CLI(codex)** 两端;改完 build/类型/测试全绿、无 dangling cursor 引用、重装产物不再含 cursor。

## 前提
- **零用户阶段**,clean-slate 直接删,不留迁移 / 不留兼容分支。
- Cursor 织进了"client 名单",**删 enum 成员会连锁触发类型错误**,TDD write-red:删→看红→逐个追平。

## 普查出的触点(grill 2026-06-15 实测,~400 处 / 3 包)
- **client 枚举骨架(4 处)**:`packages/shared/src/schemas/event-ledger.ts`(client enum ×3)、`api-contracts.ts` `client_filter`、`parity-matrix.ts` `PARITY_CLIENTS=["claudeCode","codexCLI","cursor"]`。
- **install 流水线**:`packages/cli/src/install/`(`pipeline/{env,hooks,mcp}.stage.ts`、`hooks-orchestrator.ts`、`skills-and-hooks.ts`、`uninstall-skills-and-hooks.ts`、`write-bootstrap-snapshot.ts`)、`commands/install.ts`、`config/{json,resolver,writer}.ts`、`types/config.ts`。
- **doctor**:`packages/server/src/services/{doctor,doctor-bootstrap-lints,doctor-hooks-lints,doctor-cite-coverage}.ts`、`cache.ts`。
- **i18n + 模板**:`packages/shared/src/i18n/locales/{en,zh-CN}.ts`、`templates/bootstrap-canonical.ts`。
- **模板目录**:`packages/cli/.cursor/`(hooks + rules)、`packages/cli/templates/hooks/configs/` cursor hook config。
- **docs / README**:cursor / "3 clients" 文案。
- **不要动**:`.workflow/.analysis/`(历史归档)、`ui-ux-pro-max` skill 的 CSS `cursor:` 属性、root 已安装产物(reinstall 重新生成)。

## 命名 Ship Gate(全绿即合 main)
- [ ] **G-ENUM** — 4 处 client 枚举收成 `cc`/`codex`(parity `claudeCode`/`codexCLI`);类型连锁错全追平。
- [ ] **G-SRC** — install/config/doctor/i18n/bootstrap-canonical 的 cursor 分支删净,无 dead branch。
- [ ] **G-TPL** — 删 `packages/cli/.cursor/` + configs cursor hook config;uninstall 对称。
- [ ] **G-PARITY** — `cross-client-parity.test.ts` + 快照只剩 cc+codex,绿;肉眼 diff 确认只删 cursor 行。
- [ ] **G-NODANGLE** — `git grep -i cursor -- 'packages/**/*.ts' ':!*.snap'`(排 CSS `cursor:`)= 0 处 client 语义引用。
- [ ] **G-REINSTALL** — 本仓重跑 `fabric install`:重新生成 `.claude`/`.codex`、删 root `.cursor/`、`.fabric/AGENTS.md` 不再提 cursor;`fabric doctor` 绿。
- [ ] **G-GREEN** — `pnpm -r build`(改 shared 后必 `pnpm --filter @fenglimg/fabric-shared build`)+ `pnpm -r exec tsc --noEmit` 0 error + `pnpm lint` + 全量 `pnpm -r test` 0 fail 0 skip + `pnpm test:strategy` + `pnpm test:store-only-e2e`。

## 任务(顺序,TDD)
1. shared 枚举骨架删 cursor(4 处)→ typecheck 看红(write-red)。
2. 逐个追平 cli/server 消费者 → G-ENUM + G-SRC。
3. 删模板目录 + uninstall 对称 → G-TPL。
4. 更新 parity 测试 + 快照(肉眼 diff)→ G-PARITY。
5. docs/README 文案 + `git grep` 清零 → G-NODANGLE。
6. 本仓 `fabric install` 重装 + doctor 绿 → G-REINSTALL。
7. 全量 build+tsc+lint+test 绿 → G-GREEN。

## 铁律
- 改 shared **必 rebuild dist**。删 enum 先看红再追平,别先删测试。
- 快照 `-u` 前**肉眼 diff** 确认只删 cursor 行。
- 合 main 后**通知 release-eval goal**:cross-client-parity 基线已 = 2 端。

---

## 操作 Runbook(新终端独立跑)

### ① 启动
```
cd /Users/wepie/Desktop/personal-projects/pcf-cursor-cleanup
pnpm install                       # 新 worktree 首次装依赖
claude                             # 开会话
```
会话内输入(把本 brief 作为意图,goal-mode 会读它并判为 mode①):
```
/goal-mode 读 GOAL-BRIEF.md 砍除 Cursor client 支持, 收成 cc+codex 两端, 按命名 ship gate 跑到全绿
```
→ goal-mode 搭好 `.workflow/.maestro/{session_id}/status.json` 后会**吐一行 `/goal ...`**,**把那行粘回**即开始自循环。

### ② 推进 & commit(过程中)
- 推进单步:`/goal-mode continue`(每步跑验证→原子更新 status.json→重检 gate)。
- 看进度:`/goal-mode status`。
- **commit 节奏**:每个 gate / wave 收口即提交到本分支,sha 回填 status.json `git_commits[]`:
  ```
  git add -A && git commit -m "refactor(cursor): <该 gate 做了啥>"
  ```
- 改了 shared 记得 `pnpm --filter @fenglimg/fabric-shared build` 再跑 server/cli 测试。

### ③ 收尾 + 合并回 main
G-GREEN 全绿、mode① 全 task done → goal 自动 `status=completed`。然后:
```
# 回主检出合并
cd /Users/wepie/Desktop/personal-projects/pcf
git checkout main && git pull --rebase origin main
git merge --no-ff chore/remove-cursor-support -m "Merge: Cursor client 砍除 (3端→2端 cc+codex)"
git push origin main               # 如需推远端
# 清理 worktree + 分支
git worktree remove ../pcf-cursor-cleanup
git branch -d chore/remove-cursor-support
```
**⚠️ 顺序依赖**:本 goal 必须**先合 main**,release-eval goal 才能 rebase 到 2 端基线(否则它在 3 端旧 main 上跑,cross-client-parity 对不上)。
