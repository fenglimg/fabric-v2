# Fabric CLI 命令层级重构方案

> **版本目标**: v2.2.0-rc.5
> **关联方案**: BLP-fabric-install-ux-ink-tui-2026-06-06
> **探索方式**: 多 Agent 并行探索（UX/架构/实现/竞品）

---

## 一、问题诊断（综合）

### 1.1 核心问题

| 问题 | 严重度 | 来源 |
|------|--------|------|
| 命令扁平暴露，13 个命令无分组 | 🔴 高 | UX/竞品 |
| doctor 的 15+ flag 信息过载 | 🔴 高 | UX/实现 |
| store 的 11 子命令分类混乱 | 🟡 中 | UX |
| 新用户引导缺失 | 🟡 中 | UX |
| scope-explain 命名歧义 | 🟢 低 | 架构 |
| 缺乏 workspace/store 路由 | 🟡 中 | 竞品 |

### 1.2 用户心智模型断裂

```
当前：fabric --help → 13 个扁平命令 → 用户不知道第一步做什么
理想：fabric --help → 分组显示 + "First time? Run install" 引导
```

---

## 二、设计方案（综合最优解）

### 2.1 命令层级重构

**采用 gh/docker 的对象+动作模式**：

```
fabric <object> <action> [args] [flags]

对象（4 个核心对象）：
  install    安装/初始化（保持单命令，入口）
  doctor     诊断工具（重构 flag 暴露）
  store      Store 管理（保持现有子命令，增加分组引导）
  config     配置管理（保持现有）

  info       新增：合并 whoami + status + scope-explain

动作（跨对象统一）：
  list       列出
  view       查看
  create     创建
  delete     删除
```

### 2.2 doctor 命令重构

**问题**：15 个 flag 混合诊断/修复/报告

**方案**：分层暴露 + 模式互斥

```
fabric doctor              # 默认：只做诊断报告（只读）
fabric doctor --fix        # 修复派生状态问题（写模式）
fabric doctor --fix-entries  # 修复知识条目问题（写模式）

# 报告类 flag 移到独立命令或 hidden
fabric doctor --cite-coverage    → hidden（或 fabric report cite-coverage）
fabric doctor --archive-history  → hidden（或 fabric report archive-history）
fabric doctor --lint-conflicts   → hidden（或 fabric report conflicts）
```

**flag 分类**：

| Flag | 类型 | 默认暴露 | 说明 |
|------|------|---------|------|
| `--fix` | 写操作 | ✅ | 修复派生状态 |
| `--fix-entries` | 写操作 | ✅ | 修复知识条目 |
| `--json` | 输出格式 | ✅ | JSON 输出 |
| `--verbose` | 输出格式 | ✅ | 详细输出 |
| `--target` | 范围 | ✅ | 指定检查范围 |
| `--cite-coverage` | 报告 | ❌ hidden | 引用覆盖率报告 |
| `--archive-history` | 报告 | ❌ hidden | 归档历史报告 |
| `--lint-conflicts` | 报告 | ❌ hidden | 冲突检查 |
| `--debug-bundle` | 调试 | ❌ hidden | 调试 bundle |
| `--deep` | 调试 | ❌ hidden | 深度检查 |

### 2.3 store 命令优化

**问题**：11 个子命令用户不知道何时用 `add` vs `create` vs `bind`

**方案**：保持现有命令，优化 `--help` 分组引导

```
fabric store --help

Viewing:
  list              List all mounted stores
  project-list      List project-bound stores

Mounting:
  create            Create a new local store and mount it
  add               Mount an existing store (by UUID)
  bind              Bind this project to a store

Modifying:
  remove            Detach a store (keeps data)
  switch            Change the active write store

Migration (advanced):
  migrate           Move project knowledge to a store
  promote           Promote personal entries to team
  rescope           Change entry scope

First time creating a team store? Run: fabric store create <alias>
```

### 2.4 info 命令（新增）

**合并**：`whoami` + `status` + `scope-explain`

```
fabric info              # 显示当前项目状态（原 status）
fabric info --global     # 显示全局身份（原 whoami）
fabric info scope <path> # 解释 scope 解析（原 scope-explain）
```

### 2.5 --help 层级重构

**采用 git 的渐进式暴露**：

```
fabric --help

fabric - Cross-client AI knowledge layer

First time? Run: fabric install

Setup:
  install     Initialize Fabric in this repository
  config      Configure Fabric settings

Daily:
  sync        Sync team knowledge
  info        Show project status

Diagnostic:
  doctor      Check Fabric health

Advanced:
  store       Manage knowledge stores
  whoami      Show machine identity (deprecated → info --global)
  status      Show project status (deprecated → info)
  scope-explain  Explain scope (deprecated → info scope)

Run `fabric <command> --help` for details.
```

---

## 三、实现方案（最小改动）

### 3.1 立即可实施（工作量 ≤ 2 小时）

**Phase 1: doctor flag hidden**

```typescript
// packages/cli/src/commands/doctor.ts
args: defineArgs({
  // 保持暴露
  fix: { type: 'boolean', description: 'Fix derived state issues' },
  'fix-entries': { type: 'boolean', description: 'Fix knowledge entry issues' },
  json: { type: 'boolean', description: 'Output as JSON' },
  verbose: { type: 'boolean', description: 'Verbose output' },
  target: { type: 'string', description: 'Target scope' },

  // 设为 hidden
  'cite-coverage': { type: 'boolean', hidden: true },
  'archive-history': { type: 'boolean', hidden: true },
  'lint-conflicts': { type: 'boolean', hidden: true },
  'debug-bundle': { type: 'boolean', hidden: true },
  deep: { type: 'boolean', hidden: true },
  // ... 其他内部 flag
})
```

**Phase 2: --help 分组显示**

修改 `packages/cli/src/index.ts` 的 help 输出逻辑，按分组显示命令。

**Phase 3: info 命令**

```typescript
// packages/cli/src/commands/info.ts (新建)
export default defineCommand({
  name: 'info',
  description: 'Show Fabric status and identity',
  args: defineArgs({
    global: { type: 'boolean', description: 'Show global identity' },
    scope: { type: 'string', description: 'Explain scope for path' },
  }),
  async run(ctx) {
    if (ctx.args.global) {
      // 调用原 whoami 逻辑
    } else if (ctx.args.scope) {
      // 调用原 scope-explain 逻辑
    } else {
      // 调用原 status 逻辑
    }
  },
})
```

### 3.2 废弃命令别名（backward compat）

```typescript
// packages/cli/src/commands/whoami.ts
export default defineCommand({
  name: 'whoami',
  description: 'Show machine identity (deprecated: use fabric info --global)',
  deprecated: true,
  async run(ctx) {
    console.warn('Warning: whoami is deprecated. Use: fabric info --global')
    // 转发到 info --global
  },
})
```

### 3.3 测试验证

```bash
# 验证 doctor flag hidden
fabric doctor --help | grep -c "cite-coverage"  # 应为 0

# 验证 --help 分组
fabric --help | grep "Setup:"  # 应存在

# 验证 info 命令
fabric info
fabric info --global
fabric info scope .

# 验证废弃别名
fabric whoami  # 应输出 warning
```

---

## 四、迁移策略

### 4.1 版本规划

| 版本 | 改动 | 废弃 |
|------|------|------|
| v2.2.0-rc.5 | doctor flag hidden + info 命令 + --help 分组 | - |
| v2.3.0 | - | whoami/status/scope-explain 标记废弃 |
| v3.0.0 | - | 移除废弃命令 |

### 4.2 向后兼容

- `whoami` / `status` / `scope-explain` 在 v2.x 仍可用，但输出废弃警告
- v3.0.0 正式移除

---

## 五、与 BLP-fabric-install-ux-ink-tui 合并

**里程碑**: v2.2.0-rc.5 CLI UX 优化

**子任务**：
1. **BLP-fabric-install-ux-ink-tui**：install 命令 Ink TUI 交互优化
2. **本方案**：命令层级重构 + doctor flag hidden + info 命令

**执行方式**：
- 在 worktree 中并行开发
- 完成后统一测试验证
- 合并到 main，发布 v2.2.0-rc.5

---

## 六、预期效果

| 改进项 | 效果 |
|--------|------|
| doctor flag hidden | 用户不再被 15 个 flag 困惑 |
| --help 分组 | 新用户立即知道第一步做什么 |
| info 命令 | 减少命令数量，统一信息查询 |
| 废弃别名 | backward compat，平滑迁移 |

---

## 七、参考

- 竞品分析：git (渐进式暴露), gh (对象+动作), docker (Management Commands)
- 架构设计：四组层级 + 单一职责 + 幂等性
- UX 设计：分层渐进披露 + 场景引导
