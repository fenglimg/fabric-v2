# Design — 组内分享:稳定版本确认 + 上手路径文档

## 1. 文档:为什么是「补一份」而不是「再写一份」

仓库已有**三个**上手入口:

| 现有 | 受众 | 状态 |
| --- | --- | --- |
| `README.md` §快速开始 | 路过的人 | 简短,够用 |
| `docs/USER-QUICKSTART.md`(212 行,英文) | 通用使用者 | 已含 4 步流程 / 多 store / troubleshooting —— **覆盖了本任务需要的大半** |
| `.fabric/AGENTS.md` §5 分钟上手 | 本仓 dev | 定位是 AI 策略配置,不是 onboarding |

再加一份泛泛的"快速上手"就是**第四个会互相漂移的入口**。所以:

**决定:新增 `docs/TEAM-ONBOARDING.zh-CN.md` —— 定位明确为「我们组的落地版」,不是又一份通用教程。**

判据来自本仓刚立的 state-placement 分层判据(「正确版本由谁决定」):

- `USER-QUICKSTART.md` 的正确版本由 **Fabric 项目**决定 → 保持通用、英文、不硬编码任何公司信息;
- `TEAM-ONBOARDING.zh-CN.md` 的正确版本由 **我们组**决定 → 必须硬编码具体的 store 地址、alias、找谁开权限。

两者受众和生命周期不同,所以是两份;而不是"我想多写一份"。三个旧入口各加**一行**指向新文档,不复制内容。

## 2. 组内落地版的结构

顺序按"陌生人真实会遇到的顺序",不按功能模块:

```
0. 这是什么、解决你什么痛点        ← 3 句大白话,不出现 store/scope/recall 等术语
1. 装                              ← npm i -g,含版本自检
2. 在你的项目里 install
3. 绑我们组的 store                ← 硬编码 repo 地址 + 权限找谁开
4. 验证它活着                      ← 跑一条 recall,应该看到 N 条东西
5. 写下第一条知识                  ← 归档一次,看到 pending 文件
6. 出问题怎么办                    ← doctor + 已知失败模式对照表
```

**第 4 步是整份文档的支点。** 前三步都是"配置",同事无法判断自己做对没有;第 4 步是第一个能自己确认"它活了"的时刻。没有这一步,前面任何一步默默做错都要等到很久以后才暴露。

第 6 步的失败模式对照表至少要覆盖 PRD §4 的 R5(MCP cwd=/ 导致 `fab_propose` 全挂,而 `fab_recall` 正常、`fab_pending` 返回空 —— 症状具有欺骗性,靠自查几乎排不出来)。

## 3. 稳定性验证:怎么造"全新环境"

三种造法,选一种,并**写明它验不到什么**:

| 方案 | 覆盖 | 验不到 | 成本 |
| --- | --- | --- | --- |
| **A. 临时 HOME + 临时 npm prefix + 全新 git repo** | `~/.fabric` 全新、客户端配置全新、宿主机上能真跑 Claude Code 会话验 hook | "机器上从没装过 node/git"、Windows | 低,可重复 |
| B. Docker `node:22` | 系统级全新 | **客户端 hook 验不到**(Claude Code 在宿主机)、公司内网 git 认证在容器里未必通 | 中 |
| C. 新建 macOS 用户账号 | 最真 | 需要密码、切换账号 —— 我做不了,得你来 | 高 |

**选 A。** 关键理由是 B 看起来最"干净"却恰好验不到最重要的东西:Fabric 的价值一半在 hook 于会话中自动浮现知识,而客户端装在宿主机。一个验不到核心行为的"更真实环境"是假的更真实。

```bash
export HOME=$(mktemp -d)          # ~/.fabric 全新
export NPM_CONFIG_PREFIX=$HOME/npm
export PATH=$HOME/npm/bin:$PATH
```

### 3.1 但方案 A 只是筛子,不是判据

方案 A 由**写文档的人**执行 —— 我知道该绕开哪些坑,这正是它测不出的东西。真判据只有一个:

> **找一个同事,在他自己的机器上,只给他文档链接,不在旁边指导,看他能不能走完第 4 步。**

他卡在哪里,哪里就是文档的缺陷 —— 而且是方案 A 结构上不可能发现的那一类。这一步排进 Wave 4,不能省。

(同一个道理在本仓已有实证:`fixture 全绿仍需真实 dogfood`,以及上一个任务里"测试自己制造被测前提"的两次翻车。)

## 4. 2.5.1 发版

- **语义**:main 比 `v2.5.0` 多的 8 个 commit 全是 bug 修复 + 文档 + 测试,无新功能、无破坏性改动 → patch。
- **流程**:仓库已有 `release-rc` skill 与 `.github/workflows/release.yml`。2.5.1 是正式版不是 rc,按 release skill 的正式版路径走。
- **已知雷**(来自本仓历史,不重复踩):
  - 版本号要在 root + 各 workspace + README 的 active-line 声明**同步**改(曾出现 root rc.18 vs packages rc.19 的错位);
  - 发版前必须本地跑 `pnpm -r exec tsc --noEmit`,只跑 build 不够(rc.21/24/29 三次因此 CI 红);
  - **2.0.0 这个版本号已烧,不可复用**(与本次无关,但发版流程里别撞);
  - npm publish 的 2FA 若报 403 "bypass 2fa enabled",是去 npmjs 切 2FA 模式,不是重生 token。
- **顺序**:发版排在冒烟验证**之后** —— 万一验证中又发现问题,可以一次性带进同一个版本,避免发两次。

## 5. Wave 0 必须先答的四个问题

PRD §4 的 R1~R4。其中 **R1/R2 若答案不利,scope 会实质变化**:

- 若 `wespy-team-cocos-knowledge-base` 同事没有权限 → 上手路径第 3 步断裂,得先解决权限或另建组内 store,那是一件独立的事,应该先告诉你而不是我自己决定绕过去。
- 若那个 store 的内容其实与本组业务无关 → 第 4 步"验证它活着"会返回一堆不相干的东西,分享的说服力直接归零。

所以 Wave 0 的产出是一句明确结论,不是"看起来应该可以"。

## 6. 影响面

| 文件 | 变更 |
| --- | --- |
| `docs/TEAM-ONBOARDING.zh-CN.md` | 新增(组内落地版) |
| `README.md` / `docs/USER-QUICKSTART.md` / `.fabric/AGENTS.md` | 各加一行指向,不复制内容 |
| `package.json` + 各 workspace + README active-line | 2.5.0 → 2.5.1 |
| `docs/RELEASE-NOTES.md` | 补 2.5.1 条目 |

不改任何 `packages/*/src` 代码 —— 若冒烟验证中发现代码缺陷,那是新发现,单独评估后再决定是否并进 2.5.1。
