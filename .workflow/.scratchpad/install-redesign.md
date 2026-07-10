# Fabric `install` 改版设计 — 多 store 架构下的安装流程升级

> 状态:设计已确认(2026-06-04),实现进行中。
> **2026-06-04 验证修正**:W0(write-path/recall 的 store 化)**已完成**——`rc.3 multistore 接线收口`(commit 671e874/2f09be7)+ lifecycle-refactor 已落地。
>   - 读侧:`plan-context.ts` 真消费 `cross-store-recall.ts::walkReadSetStores`(读 `required_stores ∪ personal`,不碰 repo co-location)。实测 `fab_recall` 返 `personal:KT-*` 自真实 store 路径。
>   - 写侧:`extract-knowledge.ts` 走 `resolveStorePendingBase`,store-only,co-location fallback 已删(B2 cutover);无 write-target 即硬失败(本轮归档失败即此)。
>   - **真根因 = 体验层**:store 未 bind 时 recall 退化 + **零 onboarding 引导**;`store bind`/`switch-write` 命令早在,缺的就是 **install onboarding**(= 本设计的 L1/L2 store 步骤)。见记忆 [[project-deeptest-sync-injection-gaps]] 2026-06-03 banner。
>   - 故首波从 W1(install store onboarding)起,W0 跳过。
> 关联 KB:KT-DEC-0003(dual-root,被多 store 取代)、KT-DEC-0002(clean-slate,零用户可硬删)、
> KT-DEC-0007(hook=nudge)、KT-DEC-9002(bootstrap 文件边界)。

---

## 0. 问题陈述

`fabric install` 骨架仍是 v2.0「per-repo co-location 脚手架」,多 store 全局架构是用三种方式硬塞进去的:
`--global` 当侧门 fast-path、repo `.fabric/knowledge/` 残骸仍在写、最常见的「拉团队 store 并在本 repo 用」要两条命令。
真正的病根:**首次安装必需的能力(挂 store / 建 store / 绑定 / 选写入)只能当子命令调**,
用户得自己知道 `install --global --url=… && store bind && store switch-write` 这串顺序。

---

## 1. 核心判据(两条线)

### 线 A:install = 零→可用的首次流程;子命令 = day-2 运维
- 进 install:任何「从无到可用」必需或可选的 setup 能力。
- 留子命令:装好之后的持续运维/查询(sync / store list·remove·explain / doctor* / whoami / status / metrics / uninstall)。
  排除理由统一:它们不是「零→可用」。

### 线 B:步骤 ⟷ 子命令 对偶
> 每个 install 步骤 = 一个可复用 operation,它同时以子命令暴露。
> install 在 wizard 里把它们按依赖顺序串成「可跳过的步骤」;子命令让 day-2 单独重跑某一步。
> **没有任何能力是「只有 flag」或「只有子命令」。** `--force-*-only` 逃生舱消失——「重跑某步」天然就是「再调那个子命令」。

---

## 2. Census:所有「安装性质」能力全集

| # | 能力 | 当前入口 | 层 | 判定 | 备注 |
|---|---|---|---|---|---|
| 1 | 全局家目录(uid + personal store + global config) | `install --global` / 自动补铸(install.ts:536) | L1 全局 | 必含·自动·不可跳 | 已是事务实现,只是当侧门 |
| 2 | 挂载团队 store(clone remote) | `install --url` 或 `store add` | L1 全局 | 步骤·可跳 | 双入口,首次进 wizard |
| 3 | 新建本地 store | `store create` | L1 全局 | 步骤·可跳 | wizard 当前够不着 |
| 4 | 绑定 store 到项目(`required_stores`) | `store bind` | L2 项目 | 步骤·可跳 | 与 #2/#3 同意图下半截 |
| 5 | 设活动写入 store(`activeWriteAlias`) | `store switch-write` | L2 项目 | 步骤·可跳 | 绑完顺手选写哪 |
| 6 | MCP 客户端注册 | install mcp stage / `config` | L3 接线 | 必含·可跳 | 已在 wizard |
| 7 | Hooks 接线 | install hooks / `--force-hooks-only` | L3 接线 | 必含·可跳 | force-only = 穷人版重跑单步 |
| 8 | Skills 模板 | install bootstrap / `--force-skills-only` | L3 接线 | 必含·可跳 | 同上 |
| 9 | Bootstrap 快照 + 三端传播 | install bootstrap | L3 接线 | 必含·可跳 | KT-DEC-9002 文件边界 |
| 10 | 向量/embed 模型启用 | `install --enable-embed` + host `npm i -g fastembed` + 暖缓存 | L3 可选 | 步骤·可跳·半自动 | flip config 自动,装包/下权重只能打印指引 |
| 11 | 项目脚手架(config/账本/gitignore/forensic) | install scaffold | L2 项目 | 必含·不可跳 | **要砍 co-location `knowledge/` + repo 级 agents.meta.json** |
| 12 | fabric_language 探测固化 | install scaffold | L2 项目 | 自动·不可见 | 保持 |

**排除(留 day-2 子命令)**:sync、store list/remove/explain、doctor*、whoami/status/scope-explain/metrics、uninstall、plan-context-hint/onboard-coverage(hook 内部)。

---

## 3. 升级后的 install 流程(三层 · 全步骤 · 可跳过)

```
fabric install                         # 默认:确保三层就位,wizard 引导
├─ L1 全局基座 (机器级,幂等)
│   ├─ [auto]  uid + personal store + global config      # #1 不可跳,已就位则静默
│   └─ [step]  团队 store?  ▸ 跳过 / 加入现有(url→clone+mount) / 新建本地   # #2+#3 合并
│
├─ L2 项目绑定 (repo 级)
│   ├─ [auto]  .fabric 脚手架: config/账本/gitignore (砍 knowledge/ co-location)  # #11+#12
│   └─ [step]  绑定哪些 store + 选写入目标                  # #4+#5 合并,承接 L1 选择
│
└─ L3 客户端接线 (per-client,可跳)
    ├─ [step]  bootstrap 三端传播                          # #9
    ├─ [step]  MCP 注册 (global/local · project/user)      # #6
    ├─ [step]  hooks                                       # #7
    ├─ [step]  skills                                      # #8
    └─ [step]  向量语义搜索?  ▸ 默认关 / 启用(flip+打印 host 指引)  # #10
```

### 命令面收敛
- `fabric install` → 跑全三层 wizard。
- `fabric install --global` → 只 L1(CI / 无项目机器初始化)。
- `fabric install --yes` → 全默认非交互(L1+L2+全接线,embed 关、store 步骤跳过 = 当前 solo 行为,向后兼容)。
- **删** `--url`(并入 L1 store 步骤;非交互可 `--url` 喂答案)、`--enable-embed/--embed-model`(并入 L3 embed 步骤;非交互可 flag 喂答案)、`--force-skills-only/--force-hooks-only`(改用接线子命令单跑或 `doctor --fix` reconcile)。
- store / sync / doctor 子命令全保留,作为各步骤 day-2 对偶。

---

## 4. 实现 wave 排序(注意前置依赖)

> 关键:**install 是这次多 store cutover 的「收口动作」,不是起手式**。
> 砍 co-location 之前,write-path / recall 必须先真正读写 store,否则打断唯一能跑的路径 = false-green 空壳。

0. **W0 ✅ 已完成**(rc.3 multistore 接线收口):write-path store-only + recall 跨 store。2026-06-04 验证。**跳过**。
1. **W1(进行中)**:`--url` 顶层化 = 挂载 remote store + 绑定本 repo + 设写入目标,一步到位(删 `--global` 才能用 url 的耦合)。primitives: `mountStoreFromRemote`/`storeBind`/`storeSwitchWrite` 全现成。
2. **W2 ✅ 已实现**:install wizard 加交互式 store 步骤(跳过/加入 url/新建本地 `storeCreate`)→ 自动 bind + switch-write(并入 census #2+#3+#4+#5)。
   - `bindCreatedStoreToProject`(新建本地, 与 W1 `bindRemoteStoreToProject` 对称, 含 git remote 接线)+ `promptStoreOnboarding`(post-setup 交互, 已有写入 store 则不重复问, 取消=干净 no-op 守 KT-DEC-0007)。
   - 非交互对偶:`--url`(join)+ `store create` 子命令(create)。
   - **遗留**:prompt 文案为硬编码英文(与 W1 一致),i18n key 化下沉留作 cleanup;交互 prompt 在 post-setup 而非 wizard group 内(UX 顺序略后置,但绑定需 scaffold 后的 project config,功能正确)。
3. **W3 ✅ 已实现**:`--global` 正名为「只 L1」修饰符(注释 + 语义收口;bare install 已 ensure L1→L2/L3,fast-path 即此层语义,无需结构改动)。
4. **W4 ⛔ 阻塞 — 不在本批次做(2026-06-04 验证)**:砍 repo co-location 不是删脚手架,是一整套读侧迁移。硬证据:
   - `loadActiveMeta`/`buildKnowledgeMeta` 在**热读路径**(plan-context/get-knowledge/extract)仍读 repo `agents.meta.json`(`readAgentsMeta` 缺文件即抛)+ 派生自 repo `.fabric/knowledge/` 树。
   - `doctor.ts` ~30 处读 repo `.fabric/knowledge/`;`inspectKnowledgeDirMissing` 缺子目录即告警。
   - `agents.meta.json` 被 10 个 server 服务消费(knowledge-id-allocator/load-active-meta/extract-knowledge/cross-store-recall/get-knowledge/review/knowledge-sync/doctor-cite-coverage…)。
   - 故砍脚手架会**断热读路径 + doctor 每次告警**。W4 = 把这些消费者迁到 store-based 读,属北极星主线的独立多 wave 迁移,需 TDD 逐服务搬。**留独立 goal**。
5. **W5 部分完成**:
   - ✅ **W5a**:L3 embed 步骤并入 wizard(`promptSemanticSearch`,confirm 默认关;`enableSemanticSearchAndReport` 共享 flag/wizard 两入口)。`--enable-embed/--embed-model` flag 保留作非交互喂答案(设计本意)。
   - ✅ **W5b**:删 `--force-skills-only/--force-hooks-only`(arg/函数/早返回/专属测试全清 + cli-surface 快照 regen)。替代=幂等全装(既有 install-skills-and-hooks idempotency 测试证零 diff + 保用户定制)。`--enable-embed/--embed-model` 按设计保留(非交互喂答案)。
6. **W6 ✅ 已实现**:install→recall round-trip oracle。recall 半段由 `server/cross-store-recall.test.ts`(store 条目→`team:`候选)证;install 半段新增 `install-url-bind.test.ts` W6 用例(bind helper→`scopeExplain` readSet 含 team + writeTarget=team)。两半在同一 `required_stores:[{id}]` contract 相接,无 false-green 缝。

---

## 5. 验收红线
- round-trip oracle(W6)是唯一权威收口判据,防 false-green。
- 任何「重跑单步」都走子命令,不再有 install flag。
- 零生产用户 → co-location 硬删,不写迁移路径。
