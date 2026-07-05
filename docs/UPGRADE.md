# Upgrade Guide

Fabric 的升级永远是同一套动作，与具体版本号无关：升级全局 CLI，然后在每个用到它的 repo 重跑 `fabric install`。`fabric install` 是幂等的——它把 hooks / Skills / bootstrap managed block（`AGENTS.md` / `CLAUDE.md`）同步到当前 CLI 版本。

## 标准升级流程

```bash
npm install -g @fenglimg/fabric-cli@latest   # 1. 升级全局 CLI
cd <your-project> && fabric install          # 2. 每个 repo 重跑，同步 hooks / skills / bootstrap
fabric doctor                                # 3. 验证：无 ERROR、hooks 已接线
```

第 2 步不能省。升级全局 CLI **不会**自动刷新已安装项目里的 hook 脚本和 bootstrap block；不重跑 `fabric install`，这些副本会停在旧版，导致 hook 行为与新版 CLI 不一致（历史上出现过 hook 停在旧副本、SessionStart 不注入知识、Skill 不触发等症状）。

## 升级后没生效的排查

| 症状 | 根因 | 修法 |
|---|---|---|
| SessionStart 无知识注入 | hook 脚本仍是旧副本 | 该 repo 重跑 `fabric install` |
| `fabric-archive` / `fabric-review` 不触发 | SKILL.md description 未更新 | 重跑 `fabric install` |
| `fabric doctor` 报 schema / drift ERROR | bootstrap block 或配置停在旧版 | `fabric doctor --fix` |
| 手工改过的 bootstrap block 被覆盖 | `fabric install` 幂等覆盖 managed block | 只改 `.fabric/AGENTS.md` 源，别手编两端 block |

## 铁律

- **不要手编** `AGENTS.md` / `CLAUDE.md` 里 `<!-- fabric:bootstrap:begin/end -->` 之间的 managed block，也不要手编 `.fabric/agents.meta.json`——都由 engine 派生。要改行为规则，改 `.fabric/AGENTS.md` 源，再重跑 `fabric install`。
- 挂载的 store（`~/.fabric/stores/`）里的知识**永不**被升级或卸载动到。升级只碰客户端接线，不碰知识库。

各版本具体变更见 [CHANGELOG.md](../CHANGELOG.md)。
