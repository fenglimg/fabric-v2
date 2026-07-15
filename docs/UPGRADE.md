# Upgrade Guide

Fabric 的升级永远是同一套动作，与具体版本号无关：升级全局 CLI，然后在每个用到它的 repo 重跑 `fabric install`。`fabric install` 是幂等的——它把 hooks / Skills / bootstrap managed block（`AGENTS.md` / `CLAUDE.md`）同步到当前 CLI 版本。

## 标准升级流程

```bash
npm install -g @fenglimg/fabric-cli@latest   # 1. 升级全局 CLI
cd <your-project> && fabric install          # 2. 每个 repo 重跑，同步 hooks / skills / bootstrap
fabric doctor                                # 3. 验证：无 ERROR、hooks 已接线
```

第 2 步不能省。升级全局 CLI **不会**自动刷新已安装项目里的 hook 脚本和 bootstrap block；不重跑 `fabric install`，这些副本会停在旧版，导致 hook 行为与新版 CLI 不一致（历史上出现过 hook 停在旧副本、SessionStart 不注入知识、Skill 不触发等症状）。

### 新命令 / monorepo 开发：全局 CLI 会遮蔽源码

`fabric first-hit`（以及 monorepo 里后加的同类 CLI 命令）**只存在于你安装的那份全局/本地 CLI 二进制里**。工作区源码改了但未 `npm install -g @fenglimg/fabric-cli@latest`（或未用 workspace `packages/cli/dist`）时，shell 里的 `fabric first-hit` 会报未知命令或跑旧逻辑。验证 monorepo 改动请用 workspace dist，不要默认信任全局 published 二进制。

**开发者注意（ISS-20260712-003 / 007）**：

1. **PATH 里的全局 `fabric`** 跑的是 published 包，不是当前 monorepo 的 `packages/cli` 源码。本地改 server/hook 模板后，全局 `fabric doctor` / 已装项目的 hook **不会**自动变。
2. **每个 consumer repo**（如 ccpm）的 hooks 是 `fabric install` 拷过去的副本；修 monorepo `packages/cli/templates/hooks/*` 后，必须在该 consumer 里再跑一次 `fabric install`（或从 monorepo 做 dogfood 安装路径），否则 Stop/SessionStart 仍是旧脚本。
3. monorepo 自测优先：`pnpm --filter @fenglimg/fabric-cli build` + `node packages/cli/dist/...` / vitest，或临时 `pnpm link` / 指定 dist，别只靠全局 `fabric -v`。

## 升级后没生效的排查

| 症状 | 根因 | 修法 |
|---|---|---|
| SessionStart 无知识注入 | hook 脚本仍是旧副本 | 该 repo 重跑 `fabric install` |
| `fabric-archive` / `fabric-review` 不触发 | SKILL.md description 未更新 | 重跑 `fabric install` |
| `fabric doctor` 报 schema / drift ERROR | bootstrap block 或配置停在旧版 | `fabric doctor --fix` |
| `fabric first-hit` 未知命令 / 行为旧 | 全局 CLI 落后 monorepo | `npm install -g @fenglimg/fabric-cli@latest` |
| 本地改了 hook/server 但行为不变 | 全局 CLI 或 consumer 旧 hook 副本 | 用 workspace dist 验证；consumer 重跑 `fabric install` |
| `audit cite` recall_coverage=0 但明明 recall 了 | planned 缺 session_id，或 edit path 与 recall path 不重叠 | 升级 CLI + consumer re-install；fab_recall 传真实 `session_id`；改代码前 recall 目标源码路径 |
| 手工改过的 bootstrap block 被覆盖 | `fabric install` 幂等覆盖 managed block | 只改 `.fabric/AGENTS.md` 源，别手编两端 block |

## 铁律

- **不要手编** `AGENTS.md` / `CLAUDE.md` 里 `<!-- fabric:bootstrap:begin/end -->` 之间的 managed block，也不要手编 `.fabric/agents.meta.json`——都由 engine 派生。要改行为规则，改 `.fabric/AGENTS.md` 源，再重跑 `fabric install`。
- 挂载的 store（`~/.fabric/stores/`）里的知识**永不**被升级或卸载动到。升级只碰客户端接线，不碰知识库。

各版本具体变更见 [CHANGELOG.md](../CHANGELOG.md)。
