# Implement — 组内分享:稳定版本确认 + 上手路径文档

分支:`git switch -c chore/team-share-readiness`(从 main 起)。每个 Wave 收口即 commit。

顺序原则:**先查前提 → 再写文档 → 再验证 → 最后发版**。发版放最后,是为了把验证中新发现的问题一次性带进同一个版本。

---

## Wave 0 — 先答四个前提问题(答案不利则回来改 scope)

- [ ] 0.1 **R1 确认同事该绑哪个 store**:确认 `wespy-team-cocos-knowledge-base`(公司 git)里的 107 条 canonical 是不是本组业务知识。抽样读 5~10 条标题/summary,判断"同事第一次 recall 会不会看到与自己工作相关的东西"
- [ ] 0.2 **R2 确认权限**:同事对 `git.17zjh.com/wepie-cocos/components/wespy-team-cocos-knowledge-base` 有没有读(至少)/写权限;clone 需不需要额外认证。**这一条我查不了,需要你确认或去开权限**
- [ ] 0.3 **R3 判断 64 条 pending 怎么处理**:三选一 —— ①分享前审掉一批 ②文档里一句话说明"pending 是待审区,不影响你使用" ③不管。给结论 + 理由
- [ ] 0.4 **R4 组内有没有 Windows 同事**:有则文档双写命令,没有则一句话带过
- [ ] 0.5 把四条结论写进本文件末尾的「Wave 0 结论」,**不利结论要显式说出来而不是绕过去**

> ⚠️ 0.1 / 0.2 是 go/no-go 闸。若 store 内容不相干或同事没权限,后面的文档写得再好,分享当场第 4 步就断。

---

## Wave 1 — 写组内落地版文档

- [ ] 1.1 新建 `docs/TEAM-ONBOARDING.zh-CN.md`,按 design §2 的 7 段结构
- [ ] 1.2 第 0 段(这是什么/解决什么痛点)**不得出现** store / scope / recall / canonical 等术语 —— 这一段的读者还没有任何上下文
- [ ] 1.3 第 3 段硬编码:store 的 git 地址、`fabric store bind` 的确切 alias、权限找谁开
- [ ] 1.4 第 4 段(验证它活着)必须给出**可对照的期望输出** —— "你应该看到大约 N 条,类似这样",而不是"如果成功就会有输出"
- [ ] 1.5 第 6 段失败模式表,至少覆盖:
  - MCP server cwd=/ → `fab_propose` 全挂而 `fab_recall` 正常、`fab_pending` 空(假阴性,症状骗人)
  - 没绑 store → 库是空的
  - 装了但会话没重启 → hook 不生效
  - `fabric doctor` 怎么读、`--fix` 什么时候能用
- [ ] 1.6 README / `docs/USER-QUICKSTART.md` / `.fabric/AGENTS.md` 各加**一行**指向,不复制内容
- [ ] 1.7 跑文档门禁:`node scripts/doc-drift-gate.mjs` + `node scripts/lint-dangling-refs.mjs`
- [ ] 1.8 commit

---

## Wave 2 — 全新环境冒烟验证(方案 A)

**在写完文档之后跑,而且严格照着文档走** —— 目的是验文档,不是验我记得的流程。凡是需要我"凭记忆补一步"的地方,都是文档缺陷,记下来回 Wave 1 补。

- [ ] 2.1 造环境:

  ```bash
  export HOME=$(mktemp -d)
  export NPM_CONFIG_PREFIX=$HOME/npm
  export PATH=$HOME/npm/bin:$PATH
  ```

- [ ] 2.2 造一个全新的测试项目(空 git repo,不是本仓库)
- [ ] 2.3 **只照文档操作**,逐步记录:每一步的实际输出 vs 文档写的期望输出
- [ ] 2.4 走到第 5 步(归档一次)并确认 pending 文件真的落盘
- [ ] 2.5 记录所有偏差 → 回 Wave 1 补文档 → 重跑 2.1~2.4 直到零偏差
- [ ] 2.6 把"方案 A 验不到什么"(design §3 表格第三列)如实写进本文件,不假装覆盖了
- [ ] 2.7 commit

---

## Wave 3 — 真人 UAT(唯一的真判据)

- [ ] 3.1 找**一个**同事,只给他 `docs/TEAM-ONBOARDING.zh-CN.md` 的链接,**不在旁边指导**
- [ ] 3.2 观察他卡在哪一步、问了什么问题 —— 每一个问题都是文档缺陷
- [ ] 3.3 按反馈改文档,commit

> 这一步不能省,也不能用"我自己再走一遍"替代。方案 A 由写文档的人执行,而写文档的人恰好知道该绕开哪些坑 —— 那正是它结构上测不出的东西。

---

## Wave 4 — 发 2.5.1 ✅ 完成 (2026-08-17)

放在最后,让 Wave 2/3 可能发现的问题能并进同一个版本。

- [x] 4.1 Wave 2 冷跑查出**三条**缺陷,评估后全部并进 2.5.1(见下)
- [x] 4.2 版本号同步:root + 3 个 workspace + README active-line;`scripts/sync-versions.mjs --tag v2.5.1` 通过
- [x] 4.3 CHANGELOG 补 2.5.1 条目。`docs/RELEASE-NOTES.md` **不补** —— 该文件自述只收「需要用户迁移动作」的变更,2.5.1 三条都是纯修复,零迁移
- [x] 4.4 本地 `pnpm -r exec tsc --noEmit` 通过
- [x] 4.5 全量门禁绿:build / typecheck / typecheck:tests / lint / test(3358 tests)
- [x] 4.6 commit `3fe734f2` → ff main → tag `v2.5.1` → push;Release workflow success (4m26s)
- [x] 4.7 `npm view @fenglimg/fabric-cli dist-tags` → `latest: '2.5.1'`
- [x] 4.8 round-trip:一次性 HOME 重装 latest → 2.5.1;造「PATH 上有 codex 但无 `~/.codex`」的机器,`fabric install` 正确写出 `~/.codex/config.toml` 的 `[mcp_servers.fabric]`(2.5.0 在这里静默空跑);`first-hit` 107 条 / hooks 双 true;`doctor` **从 3 条降到 2 条**,backstop 那条自行消失

### 2.5.1 修的三条(全部只在全新机器上现形)

1. **Codex 装了但没启动过 → MCP 完全没接线且不报错。** `~/.codex` 是首次运行才创建的目录,被当成了「装没装 Codex」的判据。两处独立闸门都静默。改判据为「PATH 上有 codex 可执行文件 OR 目录存在」。刻意不用 Claude 那条 `existsSync(<workspace>/.codex)` 分支 —— 那目录是 Fabric 自己写的,会给每个用户凭空造出一个 client。
2. **doctor 读 `broad_index_backstop` 的层级方向反了。** CORPUS 类键契约是 `env > store > default`(仓库层故意失效),doctor 这一个消费方用的是 `project > store > default`;又因 zod `.default()` 实体化落盘,project 层永不缺失 → doctor 永远看到 50。这就是 Wave 0 里那条 doctor 告警的根因,不是内容问题。
3. **安装失败回滚谎报「项目保持原状」。** 回滚栈为空时照说,而那正是 `.fabric/` 已建了一半的失败。零回滚拆出独立文案。

> 归档时两条 pending 的诊断被复核推翻并重提:①「能力表仍报 Codex MCP ready」是错的 —— `printCapabilitySummary` 只渲染 detected 行,是整行缺席不是误报,沉默比误报更难察觉;②「zod defaults 架空回落层」只是放大器,根因是两个消费方对同键用了相反的层级方向。

---

## Wave 5 — 收口

- [ ] 5.1 `trellis-check` → `trellis-update-spec`
- [ ] 5.2 归档判断(收口仪式),结论允许是"本段无可归档"
- [ ] 5.3 合并 main + commit

---

## 提交注意

- 非交互 shell 提交撞 stdio-lint TTY 会静默失败,用 `LEFTHOOK=0 git commit`
- 本机 Bash `grep` 是 ugrep,correctness-critical 普查改用 Grep 工具或 node
- 发版相关:npm publish 报 403 "bypass 2fa enabled" 是去 npmjs 切 2FA 模式,不是重生 token

---

## Wave 0 结论

**R1 store 是否与本组业务相关** —— 是(用户明确答复)。`wespy-team-cocos-knowledge-base` 107 条,内容是分支/MR/发版流程 + Cocos 踩坑 + 代码规范,正是这组人的日常。

**R2 分发形式** —— 改为 `ccpm install --global @fenglimg/fabric-cli`。已冷跑验证可用。ccpm catalog 条目只影响 `ccpm list` 的可发现性,**安装命令带不带 catalog 完全一样**,所以 catalog MR 不是分享的阻塞项。

**R3 分享文档载体** —— 不进仓库。放桌面:`Fabric-组内分享.md`(要发的)+ `Fabric-分享前待办(私).md`(不发)。

**R4 多检出是否会打架** —— 不会。`active_project` 取自 git remote 仓库名而非目录名,所以同一项目的多份 clone / worktree 正确共享同一套知识。

### ⚠️ 不利结论(必须显式说出来的那条)

**公司 GitLab 给知识库 `main` 加了分支保护(2026-07-28 之后),`fabric sync` 是 `pull --rebase + push`,必然被挡。** 后果:同事装上后归档的任何知识都进不了共享库,只能烂在本机 —— 本机现已积压 50 条未跟踪 pending,推不上去三周。Fabric 没有 MR 流程,等于**写入这半边功能作废**。

这是分享的**头号阻塞项**,且不是我能解决的:需要用户去要回 `main` 的推送权限。若分享当天仍未解决,分享文档「写」那一节必须改成"目前只读,写入下个迭代开",否则演示的是一个残废的闭环。
