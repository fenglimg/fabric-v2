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

**为什么用 project_id 作键而不是路径**：项目搬家后 project_id 不变，按 id 归并能自动更新路径而不是留下两条重复条目。路径作键则每次移动都产生幽灵条目。

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
- 写盘用 `atomicWriteJson`（`@fenglimg/fabric-shared/node/atomic-write`），满足 C7 的原子性；
- 全局根用 `resolveGlobalRoot()`（`store/global-config-io.ts`），自动尊重 `FABRIC_HOME`；
- 项目根用 shared 的 `resolveProjectRoot()`（`packages/shared/src/resolver/project-context-resolver.ts`），满足 C4 的 `.git` 锚点，且与 hook 侧同源；
- 版本号用 `__CLI_VERSION__` 构建期常量（`write-install-manifest.ts` 已是此法）。

## 4. 并发：选原子覆盖，不加文件锁

C7 要求多窗口并发安全。两条路：

| 方案 | 代价 |
| --- | --- |
| **原子 read-modify-write**（选用） | 两个 install 同时收尾时，后写的可能覆盖掉前者刚加的条目 → 丢一条登记 |
| `open(path,'wx')` 文件锁 | 跨平台语义不一致：POSIX 用 `EEXIST` 表示锁被占，Windows 在文件仍被其它句柄打开时 unlink 会抛 `EPERM`，表现为偶发 flake（KT-PIT-0085） |

**选原子覆盖**。理由是失败代价不对称：丢一条登记的后果是「某项目暂时没出现在列表里，下次 install 自动恢复」——自愈的、无声无害；而引入锁的后果是 Windows 上的偶发生产故障，且这类 flake 极易被当成环境噪声重跑掉。

同一台机器上两个 `fabric install` 恰好在同一毫秒收尾本就罕见，不值得为它背一个跨平台锁的长期税。

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
