# Research: packages/cli + templates 工程清晰度审计(精简去繁诊断)

- **Query**: packages/cli(85 文件 24,090 行)+ templates(83 文件 21,402 行)精简审计 6 项 + 轨A核证 4 问
- **Scope**: internal(只诊断不修复)
- **Date**: 2026-08-10
- **真源纪律**: hook/skill 行为以 `packages/cli/templates/` 为准;`.claude/`/`.codex/` 是安装副本。行号基于本日 main 工作区。

## 总量底账(实测)

| 面 | 文件 | 行数 | 备注 |
|---|---|---|---|
| `src/` 总计 | 85 | 24,090 | tsup 入口仅 2 个: `src/index.ts` + `src/scanner/tree-sitter-probe.ts`(tsup.config.ts:8) |
| `src/commands/` | 18 | 8,927 | 其中 install.ts 1,092 行是退役死件(见 §1.6) |
| `src/install/` | 32 | 7,912 | 含 pipeline/ 10 文件 2,792 |
| `src/store/` | 12 | 2,845 | |
| `src/scanner/` | 3 | 1,642 | forensic 1,475 + probe + ignores |
| `src/config/` | 6 | 1,119 | |
| sync/tui/lib/顶层 | 14 | 1,645 | |
| `templates/` 总计 | 83 | 21,402 | |
| templates/hooks/*.cjs | 7 | 5,633 | 7 个 hook 入口脚本 |
| templates/hooks/lib/ | 33 | 10,043 | **其中 5,001 行是生成物** project-context-runtime.cjs(tsup.hook-runtime.config.ts 从 shared/src/resolver/hook-runtime-entry.ts 打包,banner 标 `@generated ... DO NOT EDIT`)+ 1 行 shim project-root.cjs → 手维护 31 模块 5,041 行 |
| templates/hooks/configs/ | 3 | 176 | claude-code.json 59 / codex-hooks.json 34 / README |
| templates/skills/ | 40 | 3,330 | 全 .md:6 个 SKILL.md 668(archive 229/review 222/recall-playbook 91/config 70/store 29/sync 27)+ archive/ref **21** 文件 1,798(任务说 19,实测 21)+ review/ref 10 文件 784 + recall-playbook/ref 1 文件 5 + skills/lib/shared-policy.md 75 |
| templates/preview/ | 1 | 2,220 | lumen.html(`fabric preview` 的单文件 web UI,commands/preview.ts 读取) |
| 每仓安装副本(dogfood 实测) | 78+78 | 13,928+13,900 | packages/cli/.claude + .codex 各 78 文件 ≈ 27.8K 行/仓 |

---

## §1 精简审计

### 1.1 命令面蔓延

**现状证据**(注册真源 `src/commands/index.ts:6-44`,citty):

- 顶层 13 个:`install, store, sync, info, doctor, uninstall, config, plan-context-hint, onboard-coverage, audit, inspect, preview, first-hit`。
- 二级 24 个:
  - `store` 14 子命令(store.ts):list, create, scope, promote, backfill, reroot, mount, remove, explain, bind, switch-write, switch-personal, migrate, project —— **9 个带 `hidden:true`**(store.ts:161,199,227,244,261,308,349,405,679);`store --help` 只列 `list` + 折叠提示(index.ts:53-58)。
  - `audit` 7 子命令(audit.ts):cite, conflicts, history, descriptions, metrics(hidden, metrics.ts:143), retired, why-not-surfaced。
  - `config` 2 隐藏子命令:dismiss-slot(config.ts:423), onboard-reset(config.ts:471)。
  - `info` 1 子命令:scope(W3-F 由退役顶层 scope-explain 收编)。
- 隐藏顶层 2 个:plan-context-hint(plan-context-hint.ts:153,hook/AI 调用面)、onboard-coverage(onboard-coverage.ts:303,fabric-archive skill 调用面)。
- flag 数(实测抽取):install 11、config 12(不含 2 子命令)、doctor 9(help 里再被 renderDoctorFilteredHelp 过滤高级 flag,index.ts:37-41)、info 6、uninstall 6、preview 5、first-hit 4、inspect 3、plan-context-hint 3、sync 1;全 CLI 约 60+ flag。
- 比例:命令节点 37(13 顶层+24 二级);核心链路 install+store(1+14)+sync+doctor = 18 节点 ≈ 49%;另一半是观测/内部辅助面(audit 7、info 2、config 3、inspect、preview、first-hit、plan-context-hint、onboard-coverage、uninstall)。
- 低频/内部命令的代码占比:plan-context-hint 328 行 + onboard-coverage 333 行 + inspect 191 行 + first-hit 命令 132 行(commands/first-hit.ts,另有 store/first-hit.ts 707 行引擎)+ preview 670 行 + audit 859 行 ≈ 2,513 行,占 commands/ 的 28%。
- 已有的收敛机制:退役顶层名走 tombstone signpost(lib/command-signposts.ts,index.ts:67-75 "no silent aliases");`__tests__/cli-surface.test.ts` + `install-cli-surface.test.ts` 是 flag 漂移门。

**精简提案**:① AI-only 命令(plan-context-hint / onboard-coverage)从公共 citty 面移入单一 `fabric internal <sub>` 分组或直接由 hook 调 server 库,减少 2 个顶层名;② `first-hit` 与 `doctor --probe` 输出同源(doctor.ts:224-247 就是 assessFirstHit 快照),二选一;③ `inspect` 与 `preview` 同为"看注入/看库"读面,可合并入 `info` 分组。
**风险**:plan-context-hint 被已分发的 hook 副本按名调用(升级顺序问题);tombstone 机制已成熟可复用,风险低。
**优先级**:P2(命令面已用 hidden+folded help 控制了用户可见蔓延,真实痛点在代码量不在 UX)。

### 1.2 巨型文件(>800 行,共 9 个,合计 9,975 行 = src 的 41%)

| 文件 | 行 | 职责 | 拆分缝 |
|---|---|---|---|
| `src/install/skills-and-hooks.ts` | 1,570 | 五合一:6 skill 安装器 / 7 hook 脚本+lib 拷贝 / hook-config deepMerge+stale sweep(1002-1504)/ CLAUDE.md+AGENTS.md bootstrap 传播写手(1049-1329)/ 模板路径解析(1556+) | ①按工件族拆 skills-install / hooks-install / hook-config-merge / bootstrap-propagation 四文件;②DESTINATIONS/PATHS 常量表独立成 module(uninstall-skills-and-hooks.ts:8-16 只 import 常量) |
| `src/scanner/forensic.ts` | 1,475 | 仓库法证扫描:文件走查+git log 证据(420 行处 execFileSync git)+框架探测+按 shared schema 组装报告 | ①walk/evidence 采集 vs 报告组装;②git 交互隔离成 io 层 |
| `src/commands/config.ts` | 1,165 | 交互 config 面板 + get/set/list + profile + 2 隐藏子命令 | 面板 UI(clack)vs 键值引擎分层 |
| `src/commands/install.ts` | 1,092 | **退役 v1 install 全量副本**(见 §1.3/§1.6) | 直接删除,不拆 |
| `src/commands/uninstall.ts` | 1,069 | uninstall 编排+renderer(自述"install-v2 的视觉/语义逆",头注 26-32) | plan 构建 vs 执行 |
| `src/install/uninstall-skills-and-hooks.ts` | 1,058 | install 原语的逐个逆操作(un-merge/strip/cascade-prune) | 与正向安装器同族同构,可正逆同居按工件族拆 |
| `src/store/store-ops.ts` | 916 | mount/create/bind/migrate,对 shared 原语的 IO 包装(git clone/symlink) | git+symlink IO vs registry 变更 |
| `src/commands/audit.ts` | 859 | 7 个子命令 renderer,引擎全在 @fenglimg/fabric-server(audit.ts:3-19) | 按子命令一文件 |
| `src/install/pipeline/store.stage.ts` | 821 | install 期 store 绑定交互向导(最大 stage) | 向导 prompt 流 vs 绑定写入 |

**精简提案**:优先拆 skills-and-hooks.ts(它同时被 install 与 uninstall 依赖,是模板分发的心脏);uninstall 双文件 2,127 行与 install 侧镜像结构,长期可做"清单驱动"(一份 manifest,正逆两个解释器)。
**风险**:skills-and-hooks 拆分会牵动 uninstall 的常量 import 与 135 个测试文件里的多处直接 import;forensic.ts 拆分低风险(消费方仅 pipeline env/preflight)。
**优先级**:P1。

### 1.3 install pipeline 复杂度

**现状证据**:

- 7 阶段在 `commands/install-v2.ts:134-141` 组装:Preflight(185)→ Env(229)→ Store(821)→ Hooks(186)→ Mcp(104)→ Validate(95)→ Guidance(355);加 pipeline.ts 543 + types.ts 256 + index.ts 18 = **pipeline/ 10 文件 2,792 行**。
- 活体 install 全链 ≈ 6,112 行/24 文件:install-v2.ts 237 + pipeline 2,792 + hooks-orchestrator 289 + skills-and-hooks 1,570 + 活体辅助(run-global-install 287, install-global 163, theme-clack 126, uninstall-store 127*, transaction 86, install-scaffold-config 77, write-bootstrap-snapshot 107, store-project-onboarding 116, semantic-search 112, migrate-root-config 110, backfill-unbound-project 40)。
- **旧 install.ts 仍在**:`commands/install.ts`(1,092 行)未从注册表摘除前的 v1 全量实现,commands/index.ts:8 只注册 install-v2;cli-surface.test.ts:14-16 明文称其 "the retired install.ts twin whose flag surface can silently drift"。它拖着一个 8 文件死件簇(§1.6),且**还在被继续维护**(git 7eb84adc 最近一次触碰)。
- **双份 hooks 序列**:`hooks-orchestrator.installHooks()`(hooks-orchestrator.ts:85-145,~60 行编排)与 `pipeline/hooks.stage.ts:61-98` 是同一 21 步序列的两份手写副本;活体调用 installHooks 的只有测试(cross-client-parity/doctor-checks/hooks-install-validate/integration)与死件 install.ts:990。hooks.stage.ts:3 import 了 installHooks 却从未调用(未用 import)。
- validateHookPaths 在同一次 install 里跑两遍:hooks.stage.ts:98 + validate.stage.ts:43。

**精简提案**:①删 install.ts + 死件簇(-1,961 行,§1.6);②hooks 序列单一化——hooks.stage 改为调用 installHooks(),或反向让测试改依 stage,消掉 60 行平行编排;③validateHookPaths 只留 validate.stage 一处。
**风险**:①几乎零(不可达代码);②需同步 4 个测试文件的入口;③无(重复校验幂等)。
**优先级**:P0(①②是本审计性价比最高的两刀)。

### 1.4 模板 ↔ 安装副本双份维护面

**现状证据**:

- 分发机制:`fabric install` → HooksStage → 逐文件 `copyTextIdempotent`(skills-and-hooks.ts,字节比对,相同 skip / 不同**静默覆写**)到 `.claude/` 与 `.codex/` 双端;dogfood 实测每仓 156 文件 ≈ 27.8K 行副本。**没有 hash 清单文件**(无 .template-hashes.json 类似物,详见 §2 Q3)。
- 同步保障 = 5 个测试门,无运行时检测:
  1. `__tests__/cross-client-parity.test.ts` — .claude ↔ .codex 安装面字节平行(hook 脚本/lib/skill md 全字节等);
  2. `__tests__/hooks-runtime-generated.test.ts` — 生成物 project-context-runtime.cjs 与 shared 源新鲜度;
  3. 行为奇偶门:cite-line-parser-parity / theme-parity / render-backlog-line-parity(+ server 侧 high-value-sst round-trip);
  4. `install-cli-surface.test.ts` / snapshot-hygiene;
  5. install 期 validateHookPaths(仅存在性)。
- hooks 模板量:7 脚本 5,633 行(fabric-hint 1,035 / broad 1,616 / narrow 1,700 / pretooluse 115 / cite-policy-evict 586 / post-tooluse-mutation 439 / session-end-marker 142)+ lib 33 模块 10,043 行(手维护 5,041 + 生成 5,001 + shim 1)。注意 narrow(1,700)与 cite-policy-evict(586)在 Claude Code 端**不是注册 hook 而是被 115 行的 knowledge-pretooluse.cjs require 的库**(skills-and-hooks.ts:265 "as libs (both still copied) and merges their output")。
- skills 模板量:6 SKILL.md + 32 ref + 1 lib = 40 文件 3,330 行,全部 .md。
- "AI 才读的 prompt 文本" vs 可执行:.md 3,413 行(16%)/ .cjs 15,676 行(73%,内含 5,001 生成)/ lumen.html 2,220(10%)/ json 93。**真正手维护的双份面 = 7 脚本 + 31 lib 模块 + 40 md ≈ 14.1K 行,再 ×2 客户端副本落盘**。

**精简提案**:①把更多手写 lib 并入"生成物"通道(tsup.hook-runtime 先例已在:一个 shared TS 入口 → bundle 成 cjs),3 个 CJS 孪生(cite-line-parser/theme/high-value-predicate)是首选迁移对象,可删 3 个行为奇偶测试;②narrow 1,700 行作为"库"体量过大,与 pretooluse 编排的边界值得重划;③archive/ref 21 个 md(1,798 行)是最大的 prompt 面,按 skill 冷启动使用率裁剪。
**风险**:①hook runtime 无 node_modules 是硬约束(high-value-predicate.cjs 头注),生成物通道绕开了它,风险中低;③裁 ref 影响 AI 行为,需 A/B。
**优先级**:P1(①);P2(②③)。

### 1.5 重复/重叠

**现状证据**(抽样):

- **cli vs shared/server 分层基本干净**:store-ops.ts 对 shared 原语(initStore/addMountedStore/bindRequiredStore/explainStore,store-ops.ts:6-33)是包装非重复;audit.ts 引擎全部 import 自 @fenglimg/fabric-server(audit.ts:3-19),CLI 只做 renderer。
- **真正的重复面在 templates/hooks/lib ↔ shared**(动机:hook runtime 无 node_modules,high-value-predicate.cjs:1-7 明文):
  1. `cite-line-parser.cjs` ↔ `shared/src/cite-line-parser.ts`(手写孪生,cite-line-parser-parity.test.ts:1-19 "hand-authored CJS twin");
  2. `theme.cjs` ↔ `shared/src/theme.ts`(theme-parity.test.ts,字节等价表);
  3. `high-value-predicate.cjs` ↔ `shared/src/high-value-predicate.ts`(server high-value-sst round-trip 保奇偶);
  4. `project-context-runtime.cjs` = shared resolver 的**生成 bundle**(唯一非手写模式,tsup.hook-runtime.config.ts);
  5. 配置读取三处实现:shared schemas/fabric-config ↔ cli ↔ hooks lib 的 5 个 config 读取模块(config-cache.cjs 头注自述"每个 hook 曾各自重实现,broad 一次 SessionStart 读 5 遍文件"、store-config-reader.cjs、hint-config.cjs、hint-narrow-config.cjs、hint-thresholds.cjs,合计 ~500 行)。
- **cli 内部自我重复**:
  - hooks 安装序列两份(§1.3);
  - `commands/first-hit.ts`(132)与 `store/first-hit.ts`(707)同名双文件,命令壳 vs 引擎;
  - onboard-coverage.ts:88 自述复制了 server extract-knowledge.ts 的 readFrontmatterKey;
  - skills-and-hooks.ts:450 自述 token 估算 "Kept duplicated rather than imported"。

**精简提案**:①孪生 1-3 迁入生成物通道(同 §1.4);②5 个 config 读取 cjs 合并进生成 runtime(project-context-runtime 已含 resolver,天然宿主);③frontmatter/token 估算等"故意复制"集中登记,防继续散点繁殖。
**风险**:生成物调试体验差于手写 cjs(单文件 5,001 行 bundle);需保留 source-map 或 banner 指引。
**优先级**:P1。

### 1.6 dead code(10+ 疑犯,逐个 import 引用数,node 全量扫描非 grep)

从 2 个 tsup 入口(src/index.ts + tree-sitter-probe)做可达性分析:**85 文件中 10 个不可达,共 1,961 行(src 的 8.1%)**:

| 文件 | 行 | src 引用数 | 判定 |
|---|---|---|---|
| `src/commands/install.ts` | 1,092 | 5(全部来自下方死件簇/测试) | 退役 v1 install;cli-surface.test.ts:14 明文 "retired install.ts twin";git 7eb84adc 仍在被改 |
| `src/install/install-wizard.ts` | 233 | 1(仅死件 install.ts) | 死件簇 |
| `src/install/install-summary.ts` | 200 | 2(死件) | 死件簇 |
| `src/install/install-onboarding.ts` | 191 | 1(死件) | 死件簇 |
| `src/install/install-diff.ts` | 84 | 1(死件) | 死件簇 |
| `src/install/install-stage-output.ts` | 64 | 1(死件) | 死件簇 |
| `src/install/install-labels.ts` | 42 | 3(全死件) | 死件簇 |
| `src/install/install-path-output.ts` | 20 | 1(死件) | 死件簇 |
| `src/install/install-local-server.ts` | 18 | 1(死件) | 死件簇 |
| `src/scanner/ignores.ts` | 17 | 0 | 无人引用 |
| `src/scanner/tree-sitter-probe.ts` | ~150 | **0**(全 packages/**+scripts/** 扫描,唯一出现处是 tsup.config.ts:8 build entry) | 可行性 spike 产物(自带 "decision: feasible" 报告结构),仍被编进每次发布的 dist;doctor --probe 是 first-hit 快照(doctor.ts:224-247),与它无关 |

另有 3 处"注释级尸体":skills-and-hooks.ts:351-354+362 的 `hooks.UserPromptSubmit` arrayAppendPath 及注释声称"模板 ships a UserPromptSubmit cite-policy hook"——模板 claude-code.json 已无该键(cite-policy-evict.cjs:5-6 自述已**取代** UserPromptSubmit 方案);skills-and-hooks.ts:1334 引用的 doctor "SettingsHookDuplicates invariant" 在 doctor 检查码全集(doctor-checks.ts / knowledge-doctor-checks.ts,共 18 个 code)中不存在;pipeline/hooks.stage.ts:3 未使用的 installHooks import。

**精简提案**:一次 PR 删 10 文件 + tsup probe entry + 3 处尸体注释;死件簇的 4 个测试(install-url-bind / install-forensic-progress 等)随删或改挂 install-v2。
**风险**:接近零(不可达);唯一注意 install.ts 里是否有 install-v2 尚未吸收的行为(建议删前 diff flag 面,cli-surface 快照已覆盖)。
**优先级**:P0。

---

## §2 轨A核证四问

### Q1: fabric install 给 Claude Code 注册的 hook 事件+matcher 清单?有没有 PreToolUse matcher: Task/Agent?

**No —— 没有任何 Task/Agent matcher(无子代理 dispatch 拦截)。**
真源 `packages/cli/templates/hooks/configs/claude-code.json`(全 59 行)注册 5 事件:

| 事件 | matcher | 脚本 | 行号 |
|---|---|---|---|
| Stop | `*` | fabric-hint.cjs | :3-13 |
| SessionStart | `*` | knowledge-hint-broad.cjs | :14-24 |
| PreToolUse | `Edit\|Write\|MultiEdit` | knowledge-pretooluse.cjs | :25-35 |
| PostToolUse | `Edit\|Write\|MultiEdit\|Read` | post-tooluse-mutation.cjs | :36-46 |
| SessionEnd | `*` | session-end-marker.cjs | :47-57 |

PreToolUse matcher 只有 `Edit|Write|MultiEdit` —— 不含 Task/Agent/子代理任何形式。Codex 端(codex-hooks.json:16-27)matcher 多 `apply_patch`,并把 cite-policy-evict.cjs 挂 SessionStart(:12-14);Claude 端 cite-policy-evict 与 knowledge-hint-narrow 仅作为被 knowledge-pretooluse.cjs require 的库分发,不独立注册(skills-and-hooks.ts:265)。

### Q2: 写 `.claude/settings.json` 的策略?保不保留第三方 key?settings.json 整体非法 JSON 时会怎样?

**保留第三方 key:Yes。非法 JSON:报错拒写,不覆盖不追加,hooks 阶段 fail → pipeline 回滚退出。**

- 合并入口 `mergeClaudeCodeHookConfig`(skills-and-hooks.ts:1013-1025)→ `mergeJsonIdempotent`(:1474-1504):读现有 → 预清扫 → deepMerge → 无变化 skip / 有变化 atomicWriteJson。
- deepMerge 细节(config/json.ts:14-52 契约注释):对象递归合并;默认数组/标量/null 被 source 替换 —— 但 fragment 只有 `hooks` 一棵子树,所以 fabric 永不触碰其它顶层 key;在 `HOOK_CONFIG_ARRAY_PATHS.claudeCode`(skills-and-hooks.ts:358-364:hooks.Stop/SessionStart/PreToolUse/UserPromptSubmit/PostToolUse/SessionEnd)上数组改为 **append-with-dedupe**(dedupe 键 = 顶层 `.command` 相等,或 `hooks[0].command` 相等,或深等),ISS-20260711-261 后受保护路径绝不回落 REPLACE,用户自有 hook 条目保留。
- 预清扫 `stripStaleHookEntries`(:1402-1472)只删 command basename ∈ `FABRIC_HOOK_SCRIPT_BASENAMES`(:1344-1366,8 个 fabric 自有名)的条目,第三方 hook 条目原样保留。
- 非法 JSON 路径 `readJsonObjectOrEmpty`(:1506-1527):文件不存在→`{}`;空文件→`{}`;**JSON.parse SyntaxError(如被别的工具追加成双对象)→ 重新抛出** → mergeJsonIdempotent catch(:1487-1490)→ 该 step `status:"error"`,文件一字不动;合法但非对象(数组/标量)→ 显式拒绝 "refusing to merge into non-object JSON ... fix or rename the file before re-running fabric install"(:1513-1518,ISS-20260711-258 之前曾会覆写成 `{}`,已修)。
- 后果传导:hooks.stage.ts:101-121 收集 errors → `stageFailed("hooks")` → pipeline.ts:270-296 触发 rollback(反序执行 rollbackStack)→ install-v2.ts:151-157 `process.exitCode = 1`。install 的 validate 阶段本身**不做 JSON 合法性检查**(validate.stage.ts:42-74 只查 hook 路径存在 + .fabric 目录/fabric-config.json/events.jsonl 存在)——非法 JSON 由 hooks 阶段的 merge 步骤先行拦截。

### Q3: 有没有对已分发 hook 脚本的 hash/漂移检测(类 Trellis .template-hashes.json)?谁负责检测"副本被改/落后"?

**No hash 清单;运行中无人检测;唯一的"修复"是重跑 `fabric install` 时的字节比对覆写。**

- 无任何 hash/checksum sidecar:全包扫描无 .template-hashes 类似物;安装同步机制是 `copyTextIdempotent`(skills-and-hooks.ts,internals 段):目标存在则读出与**当前模板字节比对**,相同 → skipped "up-to-date",不同(用户改过或版本落后)→ **静默 atomicWriteText 覆写**。即检测与修复合一、且只发生在显式重装时;两次 install 之间没有任何进程会发现副本被改。
- install 内的 "validate" 只查存在性:validateHookPaths(hooks-orchestrator.ts:161-226)对 7 个脚本 × 2 客户端检查 `existsSync`,注释自认防的是 "template drift (e.g. partial copy, manual edit of one config file)" 但实现只到"文件在不在",不看内容/版本;且被调两遍(hooks.stage.ts:98 + validate.stage.ts:43)。
- doctor 不管此事:doctor 检查码全集(doctor-checks.ts:code 12 个,knowledge-doctor-checks.ts 6 个)只有 `first_hit_hooks_missing`(存在性,store/first-hit.ts:135-143 detectHooks 也是 existsSync)与 store 侧 `store_alias_link_drift`;没有 hook **内容** 漂移码。skills-and-hooks.ts:1334 注释宣称的 doctor "SettingsHookDuplicates invariant" 不存在(见 §1.6)。
- 仓库侧(非用户侧)防漂移靠测试:hooks-runtime-generated.test.ts(生成 bundle 与 shared 源同步)、cross-client-parity.test.ts(双端安装面字节平行)——这些管的是"模板自身不烂",不管"用户仓副本落后于模板"。

### Q4: SessionStart(knowledge-hint-broad 模板)输出里有没有"下一步动作"单行引导?

**基本没有 —— 显式 `下一步:` 行已被有意退役;仅剩 2 条条件/工具指引,非 Trellis 式常驻 Next-Action。**
真源 `templates/hooks/knowledge-hint-broad.cjs`(1,616 行,双 sink 架构 :874-886):

- **human sink(systemMessage)**:分组普查计数(census),非逐条墙。行 1340-1342 注释明文:"H5: the `下一步: …fab_recall…` AI-plumbing line is **retired** from the human sink"。留下的两条:①条件式 backlog 行,仅当 live pending > `REVIEW_PENDING_THRESHOLD`=10(:525, :1303)才出 `📋 Fabric backlog: … — 需要时调 /fabric-review · /fabric-archive source · fabric doctor`(:1334-1335);②常驻收尾指针 `看具体注入: fabric inspect (--explain 看每条来源)`(:1343-1348)——是"去哪看"不是"下一步做什么"。
- **AI sink(additionalContext)**:always-active 索引 + 检索方法 footer `Load full content: fab_recall(paths), or Read <store>/knowledge/<type>/<id>--*.md directly.`(:868-870, :1174-1178)——工具用法说明,非行动指令。
- 结论:输出定位是"知识索引 + 取用方法 + 超阈值才出现的维护 nudge",没有 Trellis Next-Action 那种无条件单行行动引导。

---

## Caveats / Not Found

- 行数统计用 `wc -l`;flag 数是正则抽取 citty args 的近似值(±1)。
- 可达性分析基于静态 import 图(含动态 `import()`);未发现运行时字符串拼接加载 src 内模块的路径(tree-sitter-probe 全 repo 字符串搜索也为 0 消费)。
- `install-uninstall` 对称双份(合计 ~3.2K 行)未列为"重复"因语义为逆操作,但它是清单驱动重构的候选。
- 未审计 `packages/server`/`shared` 内部(超出本任务范围,仅做了与 cli 的边界抽样)。
