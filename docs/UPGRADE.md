# Upgrade Guide

## rc.30 → rc.35 (含 rc.31/32/33/34)

rc.31 修了 `.fabric/agents.meta.json` schema (singular→plural),但 **npm 全局 CLI 不会自动同步**,老用户必须两步升级。
```bash
npm install -g @fenglimg/fabric-cli@latest   # 1. 升全局 CLI
cd <your-project> && fabric install             # 2. 每个项目重跑 (同步 SKILL.md / hooks / AGENTS.md)
```

### Verify
```bash
fabric -v        # 2.0.0-rc.35
fabric doctor    # hooks_wired ✓ 无 schema ERROR
```

### 不升级的症状
| 症状 | 根因 |
|---|---|
| SessionStart 无 banner | hooks 仍 rc.30 副本 |
| fabric-archive 不触发 | SKILL.md description 不匹配 |
| `fabric doctor` 报 schema ERROR JSON dump | meta.json 旧字段命名 |

> `fabric install` idempotent——同名 SKILL.md 会被新版本覆盖。手工改过的请提前备份。
