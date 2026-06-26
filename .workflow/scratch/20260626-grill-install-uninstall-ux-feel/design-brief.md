# Design Brief: Fabric CLI install/uninstall 终端视觉体验重做参考

## 你的任务（设计评判 + 方案产出）

Fabric 是一个跨 AI 客户端（Claude Code / Codex CLI）的知识层 CLI 工具，用 Node + TypeScript 写。
它有 `fabric install` / `fabric uninstall` 两条命令，跑在用户的终端里（支持中英 i18n，当前用户是中文）。

下面给你两段**真实终端输出**（Exhibit A=install，B=uninstall），以及一份已核到源码行号的**6 个体验缺口（G1-G6）**。
请你：
1. 审视当前视觉体验**到底差在哪**（可补充我没列到的）。
2. 产出**具体的 CLI 显示方案参考** —— 用等宽/ANSI 终端 mockup 画出来（带颜色标注说明，如 `[green]✓[/]`），覆盖：
   - 安装**收尾总结卡**（最扎眼，见 G1/G2）
   - **每阶段**的进度/结果呈现（见 G5）
   - install 与 uninstall 的**视觉一致性**（见 G3/G4）
   - **纯重装（啥都没变）** 该长什么样（见 G2）
3. 每个方案给「为什么这样画」的一句话理由 + 实现代价粗估（低/中/高）。

约束：终端宽度按 80-100 列；必须中英 i18n 友好（别把文案写死英文）；颜色要能降级到无色终端（ASCII 兜底）；
不要推翻"分阶段流水"这个骨架，是在它上面优化质感。

---

## Exhibit A — `fabric install`（一次纯重装，几乎啥都没变）

```
正在扫描项目的客户端/框架特征…
  项目扫描完成
  检测到: cocos-creator unknown 项目
  规模: 31400 文件 · 2 个入口

▌ Fabric 安装
ℹ 将按 7 个阶段执行

▌ 🔍 全局与项目预检
  ├─ [..] 全局与项目预检 (1/7)
  ├─ [ok] ✓ 全局与项目预检 (1/7)

▌ 🏗️ 项目环境初始化
  ├─ [..] 项目环境初始化 (2/7)
  ├─ [ok] ✓ 项目环境初始化 (2/7)
ℹ 3 installed, 0 skipped

▌ 📦 知识库拓扑
  ├─ [..] 知识库拓扑 (3/7)
ℹ 个人库(本机全局): 'personal' ✓
ℹ 团队库(team 类): 'wespy-team-cocos-knowledge-base' ✓
◇  为本项目挑选团队库(team 类) —— 选一个,或加入已有/新建/跳过:
│  保持当前: wespy-team-cocos-knowledge-base
  ├─ [ok] ✓ 知识库拓扑 (3/7)

▌ 🪝 Hook 与 skill 安装
  ├─ [..] Hook 与 skill 安装 (4/7)
已完成 hook 与 skill 已最新,无需改动(135 项)
  ├─ [ok] ✓ Hook 与 skill 安装 (4/7)

▌ 🔌 MCP 服务配置
  ├─ [..] MCP 服务配置 (5/7)
使用全局安装的 @fenglimg/fabric-server
已完成 已配置 MCP:Claude Code CLI / Claude Code Desktop / Codex CLI
  ├─ [ok] ✓ MCP 服务配置 (5/7)
ℹ 3 installed, 0 skipped

▌ ✅ 安装校验
  ├─ [..] 安装校验 (6/7)
安装校验通过 ✓(config / hooks 路径 / events 均就绪)
  ├─ [ok] ✓ 安装校验 (6/7)

▌ 📖 后续指引
  └─ [..] 后续指引 (7/7)
语义搜索已是启用状态 (embed_model=fast-bge-small-zh-v1.5)，未改动 .../fabric-config.json。
下一步 —— 拿到第一份价值:
  1. 重启你的 AI 客户端 (Claude Code / Codex)。它现在会自动把本项目的知识 surface 给助手。
  2. 沉淀知识: 正常干活即可 —— 当你做决策或踩坑时, fabric-archive skill 会提议入库。
  3. 验证生效: 问你的 AI「Fabric 对这个 repo 知道些什么?」, 或跑 `fabric doctor` 查健康。
更多: docs/surfaces.md 说明何时用 CLI / Skill / MCP。
重启提示: 已运行的 session 需重启才能加载新 MCP server 配置;新会话会自动使用 Fabric tools。
已检测到 4 个客户端并完成能力配置(加 --verbose 查看逐客户端明细表)。
  └─ [ok] ✓ 后续指引 (7/7)
▌ Fabric 安装完成
  ✓ 7 succeeded    ○ 0 skipped    ✗ 0 failed
  ✓ 全局与项目预检: 0 installed
  ✓ 项目环境初始化: 3 installed
  ✓ 知识库拓扑: 0 installed
  ✓ Hook 与 skill 安装: 0 installed
  ✓ MCP 服务配置: 3 installed
  ✓ 安装校验: 0 installed
  ✓ 后续指引: 0 installed
  All steps completed successfully
[ok] ✓ Done!
```

## Exhibit B — `fabric uninstall`

```
┌  卸载 Fabric
◇  要从 .../werewolf-minigame 卸载哪些部分？(空格勾选 / 回车确认;~/.fabric/stores/ 下的全局知识 store 永不删除)
│  Skills 与 hooks, MCP 客户端注册, scaffold 产物, 解绑团队 store（本项目）
Fabric 卸载计划
目标：.../werewolf-minigame
计划：bootstrap=是 mcp=是 scaffold=是 unbind-store=是
检测到的客户端：Claude Code CLI, Claude Code Desktop, Codex CLI, Codex Desktop
保留项：
  - ~/.fabric/stores/  全局知识 stores，项目卸载永不删除
◇  现在执行该卸载计划？[Y/n]
│  Yes
└  卸载计划已确认，开始执行 Fabric uninstall...

▌ Fabric 卸载
ℹ Fabric uninstall 将按 5 个阶段执行

▌ 🧹 Skills 与 hooks
  ├─ [..] Skills 与 hooks (1/5)
  ├─ [ok] ✓ Skills 与 hooks (1/5)
ℹ removed=129 skipped=16 errors=0

▌ 🔌 MCP server
  ├─ [ok] ✓ MCP server (2/5)
ℹ removed=3 skipped=0 errors=0

▌ 🔗 解绑 store
  ├─ [ok] ✓ 解绑 store (3/5)
ℹ removed=1 skipped=0 errors=0

▌ 🗑️ 清理脚手架
  ├─ [ok] ✓ 清理脚手架 (4/5)
ℹ removed=2 skipped=1 errors=0

▌ ✅ 校验已清理
  └─ [ok] ✓ 校验已清理 (5/5)
ℹ 无可移除（1 项已不存在）
▌ 卸载摘要
  ✓ 135 succeeded    ○ 18 skipped    ✗ 0 failed
  ✓ Skills 与 hooks: 已移除 129 项
  ✓ MCP server: 已移除 3 项
  ✓ 解绑 store: 已移除 1 项
  ✓ 清理脚手架: 已移除 2 项
  ✓ 校验已清理: 已移除 0 项
  135/153 steps completed
[ok] ✓ Done!
```

---

## 已核到源码行号的 6 个缺口

- **G1 中英夹杂（纯 bug）**: 满屏中文里收尾卡突然蹦英文 `7 succeeded / 0 skipped / 0 failed`、`All steps completed successfully`、`Done!`。源码 `packages/cli/src/tui/ConsoleOutputRenderer.ts:120,216,230` 三处英文硬编码，没走 i18n `t()`。
- **G2 纯重装误报 + 不折叠**: 这次啥都没真改，收尾却写 `项目环境初始化: 3 installed`、`MCP: 3 installed`，还展开完整 7 阶段流水。根因：折叠成"体检卡"的判定用 `changed` 标志（`pipeline.ts:310`），但总结卡用的是 `installed.length`（`pipeline.ts:403`）——两把尺子打架，no-op 重装既没折叠又误报数字。期望：纯重装该塌成一张"全就绪·无改动"的安心卡。
- **G3 uninstall 落后 install 一代**: `removed=129 skipped=16 errors=0` 是裸机器计数（install 已治好的病），`bootstrap=是 mcp=是` 是内部黑话泄漏给用户，结尾又一个冗余 `[ok] ✓ Done!`。uninstall 复用同一 renderer 但从没做过"人话结果行"。
- **G4 视觉接缝**: 开头提问段是 clack 风格 `┌ ◇ │ └` 框线，执行段切成 pipeline 风格 `▌ ├─ [ok]` 树枝——一条命令里两套画风对撞。
- **G5 每阶段双行**: 每个阶段先打 `├─ [..] xxx (1/7)`（进行中）再打 `├─ [ok] ✓ xxx (1/7)`（完成），两行都留底，像 debug 日志（`ConsoleOutputRenderer.ts:73` renderStep 流式渲染）。
- **G6 收尾发散**: 结尾 3 条编号 next-step + 重启提示 + 能力行，没有"现在就做这一件事"的单一锚点。

## 当前 renderer 能力（你画方案时可假设可用）
`ConsoleOutputRenderer` 已实现：`renderSection`(带 emoji 图标的阶段标题)、`renderStep`(树枝徽章 `[ok]/[..]`)、`renderSummaryCard`(收尾卡)、`renderComplete`(Done 行)、`renderInfo/renderError`、颜色 paint(可降级)。i18n 走 `t(key, params)`。
