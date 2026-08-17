# 项目注册表 — 技术设计

## 1. 落点：写在 ValidateStage，不新增 stage

`install-manifest.json` 已经由 `ValidateStage` 调用 `writeInstallManifest()` 写出（`packages/cli/src/install/pipeline/validate.stage.ts`）。注册表写入是它的**孪生动作**——两者都是「记录刚才装了什么」，都必须在所有 writer 跑完之后才有意义。

因此：注册表写入放在 `ValidateStage` 内，紧邻 manifest 写入。

**不新增 stage 的理由**：
- `StageName` 是封闭联合类型，新增一个 stage 要动类型、pipeline 接线、TUI 渲染行；
- KT-DEC-0017 规定 install 步骤与子命令保持对偶关系——注册表没有对偶子命令，它不是一个「可跳过的安装步骤」，而是一次记账；
- 新增 stage 会多出一行终端输出，而 KT-DEC-0044 要求 stage 不得增加旁白行。

`ValidateStage` 已有 `planOnly` 早退分支，C2（dry-run 不写）自动满足——这是选它的额外收益。

## 2. 数据结构

`~/.fabric/state/projects.json`：

```jsonc
{
  "schema_version": 1,
  "projects": {
    // 键 = project_id（.fabric/fabric-config.json 里已有的稳定 UUID）
    "a64bccdc-b91e-4947-90f1-432280965050": {
      "path": "/Users/wepie/Desktop/personal-projects/pcf",
      "fabric_version": "2.6.0",
      "registered_at": "2026-08-17T09:12:00.000Z"
    }
  }
}
```

### 2.1 主键：安装路径（实现期更正，第三次前提推翻）

原设计用 `project_id` 作键，理由是「项目搬家后 id 不变，按 id 归并可自动更新路径」。**实现时被实证推翻。**

证据：在测试夹具里跑完整 install 后，`.fabric/fabric-config.json` 的内容是 `{}` —— **没有 project_id**。project_id 是绑定 store 时才写入的，一个不绑 store 的 `fabric install` 根本不产生它。

按 id 作键的后果不是「少一个字段」，而是**这类项目永远不会出现在控制台里**——正是这个注册表要消灭的「装了但看不见」状态。而且它会静默发生：install 成功、无任何警告、列表里就是没有。

改为**安装路径作键**：
- 路径永远存在，且正是控制台真正需要的东西（要升级一个项目，你必须知道去哪儿跑 `fabric install`）；
- `project_id` 降级为可选字段，保留用于与 store binding 关联。

搬家场景分两种处理，各自诚实：
- **有 id**：注册时清掉「同 id、异路径」的旧条目——那确实是同一项目的旧位置；
- **无 id**：无从判断两个路径是同一项目，旧条目保留并显示为 `stale`，附「在新位置重跑 install」的提示。不猜。

> 这是本任务第三次「先量前提再动手」拦下的设计错误（前两次见 §3.1、§4）。三次都是同一个形状：**基于对代码的合理推测做设计，而代码的实际行为不同**。

**为什么不复用 `bindings/<project_id>_resolved.json`**：那些文件是 store 解析结果的派生快照，语义是「这个项目读哪些库」。往里塞路径会让一个文件承担两种职责，且它由绑定流程重写、生命周期不同。新开一个文件各管各的。

字段刻意保持最小。`stale` 不入盘——它是查询时按 `existsSync(path)` 算出来的**派生态**，落盘会立刻过期。

## 3. 模块划分

新增 `packages/cli/src/store/project-registry-io.ts`，与既有 `global-config-io.ts` / `project-config-io.ts` 同目录同风格：

```ts
export type RegisteredProject = {
  projectId: string;
  path: string;
  fabricVersion: string;
  registeredAt: string;
};

/** 快照语义：同 projectId 覆盖。失败静默（C6），返回是否写成功供调用方记 detail。 */
export async function registerProject(input: {...}): Promise<boolean>;

/** 读取 + 派生 stale。文件缺失/损坏一律返回空列表，never-throw。 */
export async function listRegisteredProjects(): Promise<
  (RegisteredProject & { stale: boolean })[]
>;
```

依赖既有能力，不自造轮子：
- 写盘用 `atomicWriteJson` + `withFileLock`（均在 `@fenglimg/fabric-shared/node/atomic-write`），见 §4；
- 全局根用 `resolveGlobalRoot()`（`store/global-config-io.ts`），自动尊重 `FABRIC_HOME`；
- **项目路径直接用 `InstallContext.target`**，不做任何路径解析，见 §3.1；
- 版本号用 `__CLI_VERSION__` 构建期常量（`write-install-manifest.ts` 已是此法）。

### 3.1 路径来源：用 `context.target`，不用 `resolveProjectRoot`（S1 核实后更正）

原设计写「用 shared 的 `resolveProjectRoot()` 取 `.git` 锚点」。**S1 核实后否决**，两个理由：

1. **它会取到错误的仓库。** `resolveProjectRoot` 的第一行是无条件返回 `process.env.CLAUDE_PROJECT_DIR`（`project-context-resolver.ts:54`），而该变量在 Claude Code 会话中是被设置的。在会话根为 A 仓的情况下去 B 仓跑 `fabric install`，注册表会把 A 的路径记成 B 的安装位置。静默错误，且症状与原因隔得极远。
2. **它是遗留适配器。** 源码注释：「Legacy hook adapter retained while callers migrate to ProjectContext」。新代码不该新增它的调用点。

**替代方案更简单也更正确**：`InstallContext.target` 就是这次 install 的写入根，由 `resolveDevMode(args.target, process.cwd())` 得出（`--target` > `EXTERNAL_FIXTURE_PATH` > `cwd`）。install 已经算好了，注册表直接用即可——**零解析，且自动尊重 `--target`**。

**由此推翻原 AC5**：`context.target` 不回溯 git root，所以从子目录跑 install 会装在子目录。注册表的职责是**如实记录 Fabric 装在哪了**，不是记录「理想上应该装在哪」。要求它回溯到仓库根，反而会让注册表与磁盘现实分叉。新 AC5 断言的是**二者一致**。

> 顺带发现（本任务范围外）：从子目录跑 `fabric install` 会在子目录静默创建 `.fabric/`。KT-DEC-0085 记录过 hook 侧的同类问题（`process.cwd()` 未回溯 git root，rc.4 已修），install 侧似乎仍是 cwd 语义。属产品化易用性问题，另开任务评估。

## 4. 并发：`withFileLock` 包住 read-modify-write（S1 核实后更正）

原设计选「原子覆盖、不加锁，接受偶发丢一条登记」，理由是跨平台文件锁有 Windows `EPERM` 坑（KT-PIT-0085）。

**该理由建立在错误前提上，已否决。** 仓库里**已经有** `withFileLock`，就在 `atomicWriteJson` 的同一个文件（`shared/src/node/atomic-write.ts:90`），而且它**恰恰是针对 KT-PIT-0085 那条陷阱加固过的**——源码里明确按 `process.platform === "win32"` 把 `EPERM`/`EBUSY` 与 POSIX 的 `EEXIST` 同等视为「锁被占，继续等」，并且只在非 win32 上让 `EPERM` 直接冒泡（那里它才真是权限问题）。

它还额外解决了两个我原本不会考虑到的问题：
- **所有权 token**：只删 token 未变的锁文件，防止超时被回收的旧持有者误删新持有者的锁；
- **超时兜底**：`maxWaitMs` 保证不会无限等；注释里记录了曾经有两条 `continue` 绕过 deadline 检查导致热自旋 hang 的历史。

所以加锁的成本是**一次调用**，不是「自己造一个跨平台锁」。原取舍里「加锁 = 背 Windows 偶发故障的长期税」不成立——那笔税已经有人交过并沉淀成代码了。

**结论**：`withFileLock(lockPath, () => 读取 → 合并 → atomicWriteJson())`。不丢数据，成本可忽略。

C6（never-throw）与锁的关系：锁超时会抛，必须被本模块的 try/catch 吞掉并返回 `false`，不得让一次记账失败中断 `fabric install`。

## 5. CLI 出口（R5）

挂到既有 `fabric info` 之下，而非新开顶层命令。

理由：`info` 已经是「Fabric 现在什么状态」的统一入口（EPIC-010 合并了 whoami/status），注册表列表正属于这个语义。新开顶层命令会扩大命令面——而项目正处在削减命令面的方向上（多个顶层命令已退休为子命令，退休名在 `lib/command-signposts.ts` 留墓碑）。

需带 `--json`，供控制台后端复用（父设计 §4：优先 import 内核，`--json` 是退路）。

## 6. 测试要点

- **不得**用「断言值恰好等于代码默认值」的写法。KT-PIT-0062 实证：曾有配置层级用例设 `HOME` 而 reader 读 `FABRIC_HOME`，配置根本没被读到，只因断言值撞上默认值而长期显绿。本任务涉及 `FABRIC_HOME` 重定向，是同一个雷区——测试须用**明显非默认的值**，并至少有一个「故意设错环境变量应当失败」的反向用例。
- 幂等用例跑三次而非两次——两次跑不出「累加型 bug 每次加一条」与「第二次才生效」的区别。
- dry-run 用例断言文件 mtime 未变，而不只是内容未变。
- stale 用例用改名而非删除，覆盖「路径还在但不是那个仓库了」更接近真实场景。

## 7. 风险

| 风险 | 应对 |
| --- | --- |
| `FABRIC_HOME` 在测试间泄漏导致用例互相污染 | 每个用例独立 tmp 目录 + `beforeEach` 显式设置，不依赖前一用例状态（KT-PIT-0062 记录过 fixture「无值就跳过写」导致配置静默沿用） |
| macOS APFS 不区分大小写，路径比较可能假通过 | 路径比较用规范化后的严格相等；如加路径去重逻辑需注意 KT-PIT-0084（`existsSync` 类门禁在 APFS 上会把大小写不同的路径判为存在，只在 CI 的区分大小写文件系统上才红） |
| 全局装的 `fabric` 遮蔽本仓源码，验证时看不到改动 | 验证走 `pnpm --filter @fenglimg/fabric-cli build` + workspace dist / vitest，不信任 PATH 里的全局 `fabric`（本机全局是 2.5.0-rc.4，落后本仓） |
