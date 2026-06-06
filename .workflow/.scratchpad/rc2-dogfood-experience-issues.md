# Fabric rc.2 Dogfood — 体验问题清单

> 载体: 全局 `@fenglimg/fabric-cli@2.2.0-rc.2`(本地 pack 安装)关联到 `werewolf-minigame-5sp3` 项目实地体验。
> 用法: 用户在实际使用中遇到卡点/别扭就提,这里逐条记录。每条只记 **现象 + 期望**,不预设方案;待积累一批后再统一提优化。

## 字段约定

- **来源**: `🔍 setup 自曝`(本次安装过程中 fabric 自己暴露) / `🙋 用户体验`(用户实地使用提出)
- **状态**: `📝 待确认` → `✅ 已确认` → `🛠 已提方案` → `🎯 已修复`
- **严重度**: `高`(挡路/报错) / `中`(别扭/绕路) / `低`(打磨项)

---

## 清单

### #1 · `fab_recall` 遇 personal 层孤儿条目直接抛硬错
- **来源**: 🔍 setup 自曝
- **严重度**: 高
- **现象**: `personal:KP-DEC-9001` 在 `agents.meta.json` 缺失,整个 `fab_recall` 调用直接报错失败,被迫退到 `layer_filter: team` 才拿到结果。单个派生态不一致 → 整次 recall 全挂。
- **期望**: 孤儿/缺失条目应被跳过并 warn,而非让整次 recall fail-hard。
- **状态**: 📝 待确认

### #2 · 13 条 draft 描述是空壳且无声隐藏
- **来源**: 🔍 setup 自曝
- **严重度**: 中
- **现象**: `summary === stable_id` 的 13 条 draft 被 preflight 直接隐藏,提示跑 `fabric doctor --enrich-descriptions`,但用户根本不知道有这条命令、也不知道有 13 条被吞了。
- **期望**: 空壳条目的存在与补救路径应在用户能看到的地方提示,而非埋在 diagnostics。
- **状态**: 📝 待确认

### #3 · `fab_recall` 一次性回正文 payload 偏大、把优化甩给调用方
- **来源**: 🔍 setup 自曝
- **严重度**: 低
- **现象**: recall 返回 `mcp_payload_warn`,工具自己警告 payload 大、建议改用两步 flow —— 等于让调用方承担截断负担。
- **期望**: 默认就该有合理的 body 截断/分页,而不是先全塞再警告。
- **状态**: 📝 待确认

### #4 · 已装项目的派生态无声 drift,普通用户一脸懵
- **来源**: 🔍 setup 自曝
- **严重度**: 中
- **现象**: `werewolf-minigame-5sp3` 之前装过 fabric,但 `agents.meta.json` / `forensic.json` 莫名缺失,`fabric doctor` 报 4 个 error。派生态会无声 drift,普通用户碰到只会懵,不知道跑 `doctor --fix`。
- **期望**: 派生态缺失时,在 session 自然 checkpoint(如 SessionStart)给出可读的自愈提示。
- **状态**: 📝 待确认

### #5 · `fabric install` 客户端能力摘要过时,应升级为「5 端 × 四能力全支持」
- **来源**: 🙋 用户体验
- **严重度**: 中
- **现象**: 当前 install 末尾的「客户端能力摘要」表把 Claude Desktop / Cursor 的 Hook/Skill 标成 `不适用` + `需要手动后续处理`,且**漏了 Codex Desktop** 这一端。
- **期望**: 应支持 5 端 —— **Claude CLI / Claude Desktop / Codex CLI / Codex Desktop / Cursor**,各端的 **Bootstrap / MCP / Hook / Skill** 行为都应能支持并如实呈现。
- **交叉**: 与既有认知一致 —— Cursor 实际完整支持 Skills/Hooks/MCP(三端能力矩阵纠偏),当前摘要的「不适用」是旧 capability 三档降级的残留口径。
- **状态**: ✅ 已确认(口径确属过时)

### #6 · `下一步 —— 拿到第一份价值` 文案需随 5 端现实更新
- **来源**: 🙋 用户体验
- **严重度**: 低
- **现象**: install 末尾「下一步」引导只点名 Claude Code / Codex,重启 + fabric-archive/fabric-import,未覆盖 Cursor,也未反映当前能力。
- **期望**: 文案与 #5 的 5 端能力矩阵对齐,把客户端列全、动作描述与当前版本一致。
- **状态**: ✅ 已确认(随 #5 一起改)

### #7 · 安装策略本身是旧版形态,与当前版本不适配
- **来源**: 🙋 用户体验
- **严重度**: 中
- **现象**: 当前 install 交互流程基本「全填 yes 即可」,像是旧版本沿用下来的;用户印象里新版本已引入**向量模型/embedding 检索**方向,但安装流程里没体现相关 setup。
- **期望**: 复核安装策略是否需要重做 —— (a) 交互项是否还有意义 / 是否该精简;(b) 向量/embedding 检索若已落地,其模型选择/离线 pin 是否应进 install 流程。
- **备注**: 向量方向在产品池里是 conditional-absorb(离线 fastembed 击破但须自 pin),需先确认「是否真已接线进 install」再决定文案与流程。属**设计确认**类,先记着。
- **状态**: 📝 待确认(需先查接线状态)

### #8 · doctor 两条 Warn:metric event 残留泄漏 + SKILL.md 超 token
- **来源**: 🙋 用户体验(实地分析)
- **严重度**: 中
- **现象**:
  - **Warn 1**: `events.jsonl` 残留 1 条 `knowledge_context_planned`(metric-counter 类 event)。rc.37 Plan B 已把这类计数 event 改走 `metrics.jsonl`,这条是旧逻辑遗留行。**附带**:`metrics.jsonl` 长时间未刷新(server 端 60s flush tick 在 idle 下停摆)→ doctor 一直亮黄灯。修法二选一:`fabric doctor --fix` 触发 rotation 清出 / 重启 MCP server 重调度 flush+rotation。
  - **Warn 2**: `fabric-archive` 的 `SKILL.md` = 5616 tok 超预算,是 maintainer 侧 progressive-disclosure 缺失(应把详情下沉 `ref/`),对功能零影响、只多耗 context。
- **版本号澄清**: 全局 CLI = `2.2.0-rc.2`(npm 语义版本);doctor/bootstrap 文案里的 rc.31/36/37 是 engine 内部里程碑编号(另一套命名),二者不冲突,非版本不匹配 bug。
- **交叉**: Warn 1 与走查 **F16(metric leak 持续泄漏)/ F1(--fix rotation 文案承诺无效)** 同源;走查 F16 已**推翻**「纯历史残留」判断 —— 见 Part B。
- **状态**: ✅ 已确认

### #9 · knowledge 文件夹行为紊乱 + 全局知识库「项目/团队/组织」递进设计疑似未接线
- **来源**: 🙋 用户体验
- **严重度**: 高
- **现象**:
  1. 当前项目 `.fabric/knowledge/` 与全局 `~/.fabric/` 都各自有「知识 + 行为」,分布与职责边界不清。
  2. **晋升路线不明**:`pending/` 项最终该落到哪一层?是否保留项目级 `knowledge/` 文件夹?
  3. **关联关系不可见**:无法确认当前项目知识库与全局知识库的实际关联/读写路由。
  4. **分层设计落空**:之前讨论过的「项目知识库 → 团队 → 组织 …」递进式分层,现在的全局知识库行为并没有体现这套设计。
- **用户疑问**: 「感觉之前商量过,是忘记做了,还是未接线?」
- **核实结论(已查源码,2026-06-03)**: **不是未接线 —— 读/写侧已在 lifecycle-refactor 接线**:`f0ec45f` 读侧(plan-context.ts:364 真调 `buildCrossStoreRawItems`)/ `a1d1969` 写侧 / `a6fffdb` approve→store canonical round-trip。(我先前「multi-store 整套未接线」的印象来自 refactor 之前的旧态,已过时。)
- **真根因**: 电线接好但**没插插头 + 零引导**。`cross-store-recall.ts`:`readSet.stores.length === 0 → return []`,且 plan-context 套 `.catch(() => [])` 静默吞错。werewolf 项目**未 bind 任何 store**(`~/.fabric/stores/<uuid>/` 空)→ 跨 store 永远空 → 实际体验退化为 **dual-root co-location**(项目 `.fabric` + 全局 `~/.fabric` 个人层),看不到「项目→团队→组织」递进。
- **缺的是体验层**: (a) 无 store 时零 onboarding 教你 bind(=走查 **F3**);(b) 递进 scope 阶梯在 CLI/文案里不可见;(c) 静默 fallback 把「没接通」伪装成「没东西」。
- **交叉**: 走查根因簇 1(store/scope/meta 解析:F3/F4/F7→F24/F25)。
- **状态**: ✅ 已确认现象 + 已核实接线结论(根因 = bind/引导缺失,非接线缺失)

---

## Part B · goal-mode 全功能走查(23 条 confirmed,纯发现)

> 来源: 用户在 werewolf 项目跑 `/goal-mode` 模式②(审计驱动·纯发现),7 轮 loop-until-dry 收敛。
> **status.json 为真源**,此处为投影。3 high / 13 medium / 7 low,归 6 根因簇。
> 与 Part A 去重映射见末尾。

### 🔴 HIGH (3)
| id | 面 | 一句话 |
|---|---|---|
| F7 | MCP/KB | personal 层 body 两条 read 路径全废(`fab_recall` + `get_sections` 都报 not-present),只能看 summary;recall 是默认入口却默认炸 |
| F16 | CLI/KB | metric event **持续**泄漏进 audit ledger(一轮走查 +11 行),**推翻**「历史残留」判断,重启 server 仅治标 |
| F20 | KB/Hook | cite policy 自动记账闭环断裂:recall 炸→无法记账→nudge 死循环空转(~12 次),cite-coverage Edit 触达数 = 0 |

### 🟠 MEDIUM (11)
| id | 面 | 一句话 |
|---|---|---|
| F3 | CLI | team store 未 bind→任何 scope readSet 不含它、writeTarget=null、零 warning 零引导 |
| F4 | CLI | store list(git remote) vs explain/whoami(registry) 对 personal remote 矛盾;sync push every store 潜在隐私 |
| F6 | CLI | `serve --help` 不显示专属帮助 + 顶层命令清单遗漏 serve |
| F8 | MCP | `get_knowledge_sections` 的 `ai_selection_reasons` 标 optional 实际必填 |
| F10 | KB | personal 层大量 `summary==stable_id`,broad 每次 surface;doctor summary 透明度只扫 team 漏检 |
| F13 | MCP | `extract_knowledge` schema required 遗漏 `source_sessions`,照 schema 给齐仍被拒 |
| F15 | MCP | review reject 原地软删,文件留 `pending/` 目录,语义不直观 |
| F21 | CLI | `scope-explain` 不校验 scope 名,胡乱 scope 静默 fallback personal |
| F22 | KB | cite nudge 口径 vs 稽核口径矛盾(Edit 触达数 0) |
| F23 | CLI | `--fix-knowledge`(破坏性知识写)无 dry-run 预览 |
| F24 | Skill | `fabric-connect` 依赖炸掉的 recall + `fabric-audit` 漏检 personal → 两 skill 实质不可用/盲区 |
| F25 | Skill | `fabric-import` 因 scope-explain team 坏(F3),team 知识误路由进 personal 个人库 |

### 🟡 LOW (7)
| id | 面 | 一句话 |
|---|---|---|
| F1 | CLI | doctor warn 文案承诺 `--fix` 触发 rotation 实则无效(被 F16 修正) |
| F2 | Hook | cite nudge 对 `.workflow` 元文件触发噪音,无干净消除途径 |
| F12 | MCP | session_id 要 caller 传但拿不到,server(archive_scan)自己却有 |
| F17 | Hook | 实际 5 个 fabric hook,AGENTS.md 只描述 3 类 |
| F18 | Hook | hook `.cjs` 体积巨大(fabric-hint 96KB / narrow 70KB),每次触发执行 |
| F19 | Config | archive 阈值 文档 5 vs 配置 20 不一致 |
| F26 | CLI | `sync --continue/--abort` 无进行中 sync 时吐 JS stack trace(暴露 node_modules 路径) |
| F27 | CLI | `whoami/status --json` 被静默忽略(仍输出文本),--json 支持不一致 + 未知 flag 静默吞 |

### 🧬 根因簇
1. **store/scope/meta 解析**(根因 F3/F4/F7)→ 下游 F20/F24/F25 — **最高优先**
2. **schema 契约不可信** F8/F13
3. **cite 体系空转** F2/F20/F22
4. **metric leak** F1/F16
5. **doctor 覆盖盲区(只扫 team 漏 personal)** F10→F24
6. **CLI 文案/校验缺口** F6/F12/F17/F18/F19/F21/F23/F26/F27

### scratchpad 弱信号(未入正式 findings)
install --dry-run 文件列表重复呈现 · uninstall 文案「团队知识树」指代项目本地 knowledge · extract_knowledge 默认 layer=team 对 throwaway 偏激进 · PERSONAL-LEAK-CANARY surface(by design) · fabric-review 15KB SKILL.md 未被 doctor token flag。

### 未跑(不可逆副作用,已知缺口)
sync 真推送 / `--fix-knowledge` 真执行 / import 真写 / include_related(本项目无 related 边无法实测)。

---

## Part A ↔ Part B 去重映射

| Part A 手记 | 对应走查 finding | 关系 |
|---|---|---|
| #1 recall personal 硬错 | **F7 + F20** | 同一问题;F20 揭示其连锁炸了 cite 记账闭环 |
| #2 draft 空壳隐藏 | **F10** | 同源;F10 补充 doctor 透明度只扫 team 漏检 personal |
| #3 recall payload 偏大 | (走查未单列) | 保留为独立条 |
| #4 派生态无声 drift | (setup 特有) | 保留;与根因簇 1 相邻 |
| #8 Warn1 metric 残留 | **F16 + F1** | 走查推翻「历史残留」→ 实为持续泄漏 |
| #9 知识库分层未接线 | **根因簇 1(F3/F4/F7→F24/F25)** | 现象的架构根因 |

---

### #10 · 知识库「半迁移」状态:个人轴走新 store / 团队轴退回旧 dual-root,且项目零绑定
- **来源**: 🙋 用户体验 + 🔍 源码核验(2026-06-03)
- **严重度**: 高
- **现象(磁盘真相)**:
  - 全局注册表 `~/.fabric/fabric-global.json`(uid `u-0d5908a96208`)挂了 2 个 store:`personal`(`personal:true`)+ `team`(remote `fabric-store-team-synthetic.git`)。
  - 条目分布:旧 `~/.fabric/knowledge/` = **0** · personal store = **23** · team store = **61** · werewolf 项目本地 = **0**。
  - **个人写入已走新模型**(落 personal store)→ 旧 `~/.fabric/knowledge/` 被弃用空置;**团队写入仍走旧 dual-root**(落项目 `.fabric/knowledge/`),因为没设 `active_write_store`。= 系统处于半迁移态,新旧并存。
- **关联断裂(核心)**: werewolf 的 `.fabric/fabric-config.json` **无 `required_stores`、无 `active_write_store`**(纯默认)。后果(scope-explain 实测):
  - `scope team` → readSet **不含 team store**(只剩隐式 personal),`writeTarget = null`。
  - `scope project` → 同上,writeTarget null。
  - 即:team store 挂在全局却对项目隐形 —— 「公司知识库」物理存在但读不到、写不进。
- **两个缺失开关**: `required_stores`(项目级,决定读哪些 store)+ `active_write_store`(由 `fabric store switch-write <alias>` 设,决定非个人写入落点)。install 全程不引导设这俩。
- **附带矛盾(F4 实锤)**: `store list` 报 personal 有 remote(`fabric-store-personal-pcf.git`),`whoami` 报 personal「仅本地」,注册表无 personal remote —— 三处口径打架。
- **状态**: ✅ 已确认(源码 + 实时 CLI 双证)

<!-- 新条目追加到这里,沿用上面的格式 -->

---

## Part C · 设计方向(用户 normative 输入,2026-06-03)

> 来源: 用户 dogfood rc.2 后对知识库架构的 8 条方向性判断(多为 `应该/不应该` normative 表达)。
> 每条附**现状核验**(源码/CLI 实证)+ **我的判断**。属设计决策类,待收敛后可提升为 Fabric KB decisions。
> 关联: Part A #9/#10 · Part B 根因簇 1 · 记忆 [[project-layered-kb-registry-northstar]]。

### D1 · 删除旧 `~/.fabric/knowledge/` 路径,禁止再写入
- **用户**: 全局 `~/.fabric/knowledge` 应避免写入,并删除该路径。
- **现状核验**: 该路径 = 旧 dual-root 个人层,实测 **0 条**(个人写入已改路由进 personal store)。即已是死路径。
- **判断**: ✅ 同意。属半迁移残留(见 D7/#10)。删除前需:(a) 确认无任何代码仍 fallback 写它;(b) 一次性迁移守卫(若有残留先搬进 personal store)。`cross-store-write.ts` 注释证实个人写入已不落此处,删除风险低。

### D2 · `stores/<uuid>/` 目录名改用 git 仓库名(可观测性)
- **用户**: uuid 作记录可以,但作目录名不好观测,建议用实际 git 知识仓名。觉得呢?
- **现状核验**: uuid 作 store 身份是**刻意决策**(KT-DEC-0004 + northstar):身份 = intrinsic UUID,remote 仅 locator —— 为的是**改名/换 remote 时路径不破**(path-decoupled)。
- **判断**: 🟡 半同意,但**不建议直接拿仓名当目录名**。仓名当路径会把当初用 UUID 规避的脆弱性(改 remote / rename 即路径失效)重新引入。**更优解 = UUID 仍作物理身份,叠一层可读信号**:如 `stores/<alias>` symlink 指向 uuid 目录,或目录名 `<alias>-<uuid前8位>`,或就靠 `whoami`/`store list` 的 alias→uuid 映射做 UI 层观测。本质是「身份稳定」与「肉眼可读」可兼得,不必二选一。
- **✅ 用户决策(2026-06-03)**: **UUID 仍作物理身份不变**,在此基础上加一层可读性呈现。具体呈现形态(symlink / 复合目录名 / 纯 UI 层)待实现期定。

### D3 · 「公司知识库」的 org/business 分层(projects/team/teams/origin/origins)疑似漏做
- **用户**: `team` 其实算 business 概念;记得讨论过公司知识库里 projects/team/teams/origin/origins 的分层,记忆中应保存,当前像漏做。
- **现状核验(已全局搜)**: **你没记错**。① 代码 `scope.ts` 有开放坐标 schema,`KNOWN_SCOPE_PREFIXES=["personal","team","project","org"]`,举例 `org:acme:team:platform`;② 记忆 [[project-layered-kb-registry-northstar]] 完整记录开放阶梯「个人/项目/多项目/团队/多团队/组织」+ rank 合并 + 「只先实现 3 档、留接口」纪律;③ 但 resolver/store **只接了 personal+team 两层**,`project:x` 档未成型、org 未接。还有 pending 决策 `.fabric/knowledge/pending/decisions/single-git-kb-all-scopes.md` 相关。
- **判断**: ✅ = 设计完整 + 接口留了 + **接线只做了一半**(非漏记,是漏做)。`project:x` 这一档至少该补上(northstar 的 3 档纪律里它是核心);org 可继续 defer 但 scope 字符串已能表达。

### D4 · 公司库↔项目关联的交互缺失(install 引导 / 配置 / 向量模型同病)
- **用户**: 关联指定项目的公司知识库,交互没做好,属 install 引导或配置缺漏;向量模型也是,交互不友好。
- **现状核验**: 关联 = 项目 `.fabric/fabric-config.json` 写 `required_stores` + `fabric store switch-write <alias>` 设 `active_write_store`。werewolf 两者皆无 → team store 隐形(=#10/F3)。install 全程不引导设这俩;向量(embedding)setup 同样不在 install 流程(=#7)。
- **判断**: ✅ 核心缺口。**精确定位(2026-06-03)**: 命令**早已存在** —— `fabric store bind <alias>`(写 required_stores)+ `fabric store switch-write <alias>`(写 active_write_store)。缺的**不是命令,是 onboarding**: `install` detect 到已挂载 store(尤其带 remote 的 team)时,从不主动引导跑这两条。修法 = install/doctor 在「有 store 未绑定」时 nudge `store bind` + `switch-write`。向量同理需 onboarding。

### D5 · 项目内 `.fabric/knowledge/` 也不应写入;pending 应按个人库/公司库各自分层
- **用户**: 项目内 knowledge 不应写入;pending 应分个人知识库和公司知识库,同样思想建 pending 层。
- **现状核验**: 现 pending 走 dual-root(`event-ledger.ts:463` 注释:team→项目 `.fabric/knowledge/pending/`、personal→`~/.fabric/knowledge/pending/`),**不在 store 内**。
- **判断**: ✅ 与 D1/D7 一致 —— store 成为唯一知识家后,pending 也该内化进各自 store(`stores/<uuid>/knowledge/pending/`),项目本地不再承载知识 body(对齐 northstar「项目 .fabric 退化为身份证+引导页」)。

### D6 · 交互方式整体升级 + 入门 skill(概念不可自解释)
- **用户**: 当前交互烂,概念无法通过自然交互路径理解;在交互路径上改善 or 专门写入门 skill。
- **现状核验**: store/scope/readSet/writeTarget/required_stores/active_write_store/personal-vs-team 等概念无 onboarding 串联;`whoami`/`store list`/`scope-explain` 还互相矛盾(F4)。
- **判断**: ✅ 两条都要:(a) 交互路径内嵌引导(install/doctor 主动 nudge 关联与写目标);(b) 一个 `fabric-onboarding`/入门 skill 把「知识在哪、怎么流、怎么关联公司库」讲清。先 (a) 止血,(b) 系统化。

### D7 · 半迁移须明确终结:不应再允许旧 dual-root 行为
- **用户**: 系统处于半迁移,需明确;保持旧 dual-root 行为不应被允许。
- **现状核验**: `cross-store-write.ts` 刻意保留 dual-root fallback「逐字节不变」,只在 mount+选定 store 后才走 store —— 设计意图是「绝不静默搬知识」,副作用是团队知识永远走旧路。
- **判断**: ✅ 同意作**终态**,但需**分阶段**:直接禁 fallback = 没绑 store 时写操作硬失败 = 更差。正确顺序 = 先补 D4 引导 + 一次性迁移,store 体系就位后再把 dual-root 降级为「迁移期兼容」最终移除。否则禁令会变成新的踩坑。
- **✅ 用户决策(2026-06-03)**: **强制执行,快刀斩乱麻** —— 当前 0 真实用户,不需要分阶段/迁移期兼容。直接移除 dual-root fallback,store 模型成为唯一路径。**前置硬依赖**: 必须同时补上 D4 的关联 onboarding(否则没绑 store 时写操作硬失败)。即「砍 fallback」与「装引导」打包同批落地,不可只砍不装。

### D8 · `scope team` readSet 空 = 交互层未要求绑定所致(归因确认)
- **用户**: scope team readSet 只有 personal、writeTarget null,是交互层没要求绑定导致的。
- **现状核验**: 实测 `scope-explain team` → readSet 仅 personal、writeTarget null;根因 = werewolf 未声明 `required_stores`(resolver 逻辑正确,缺的是上游绑定输入)。
- **判断**: ✅ 归因正确。这不是 resolver bug,是 D4 交互缺口的下游表现。修 D4 即解。

> **整体「怪味」诊断**: 当前 = 一套**已设计完整、代码留了接口、却只接线了一半**的分层知识库 —— 个人轴上了新 store、团队轴还在旧 dual-root,开放阶梯只落地 2/N 档,且**零 onboarding 把这些概念接给用户**。怪味 = 设计意图(多 store 分层)与实际可达体验(dual-root 二元 + 隐形 team 库)之间的**落差**。

---

## 终态预期 + 行动顺序(2026-06-03 用户确认)

> **终态一句话**: Fabric 是一套「个人/项目/团队」分层知识库 —— 每个项目装好即被引导连上该连的库,知识只住在库里(无老路 dual-root、无假"施工中"告示),首次使用有 onboarding 带入门。

**四动作全做,严格按 A→B→C→D 顺序推进**(底层已接线,本质是"拆围挡 + 装门 + 补半层 + 修硬伤"):

| 序 | 动作 | 落地内容 | 关联条目 |
|---|---|---|---|
| **A** | 装门铃(onboarding) | install detect 到已挂载 store 时引导 `store bind`+`switch-write`;doctor 在"有 store 未绑定"时 nudge | D4 D8 F3 #10 |
| **B** | 拆围挡(砍旧路+删假告示) | 删 F28 三处 `experimental-unwired` 打印+i18n key+stale 注释;砍 dual-root fallback;删空置 `~/.fabric/knowledge` | F28 D1 D7 #10 |
| **C** | 补半层 | 补 `project:x` 分层成型;pending 按 store 归位;store 目录加可读层(UUID 身份不变) | D3 D5 D2 |
| **D** | 修硬伤+打磨 | recall 个人层孤儿条目崩→跳过+warn;cite 记账闭环修通;一批小毛刺(口径打架/报错堆栈/draft 空壳/文案数字不符) | #1 F7 F20 #2 F10 F4 F26 F8 F13 #8 |

**执行纪律**(用户约束): 主线串行 Edit/Bash 优先,Agent 仅在真正需要并行/独立上下文时开,不让编排开销替代实际工作量。**B 的前置硬依赖**: 砍 dual-root 必须与 A 的引导同批落地(否则没绑库时写操作硬失败)。

---

## 实验验证 · D4/D8 修法有效性(2026-06-03,werewolf 项目,可回滚)

- **操作**: `fabric store bind team` + `fabric store switch-write team` → 项目 config 写入 `required_stores:[{id:team}]` + `active_write_store:team`(config 已备份 `/tmp/werewolf-fabric-config.backup.json`)。
- **结果(scope-explain team,绑定前 → 后)**:
  - readSet: `[personal]` → **`[team, personal]`**(team store 61 条进入 readSet)
  - writeTarget: `null` → **`team`**(团队知识写入落 team store,不再回退项目本地)
- **结论**: 底层读/写接线**全通**,根因 100% = 缺 `bind`+`switch-write` 的 onboarding 引导(D4)。底层无需改,补交互即可。**命令存在但不引导** = 本轮最高 ROI 修复点。
- **回滚**: `cp /tmp/werewolf-fabric-config.backup.json <werewolf>/.fabric/fabric-config.json`(或 `fabric store remove`/手删 config 两字段)。

---

## 核验 · sync push + fabric-sync skill(2026-06-03,源码级)

> 起因: 旧记忆 F-SYNC-NOPUSH(CRITICAL,「sync 只 pull 不 push」)+ 用户记得 sync 应走 `fabric-sync` skill 而非裸 CLT。两条均核验。

- **① `git push` 已接线且真被调用**(推翻旧记忆): `run-sync.ts:42` 注释「v2.1 global-refactor (W2-T3, F-SYNC-NOPUSH): the push half of sync」;`defaultPush`(184)= 真 `git push`;settle 循环 `:329 pushOutcome = push(dir)` 干净 rebase 后即推,`options.push ?? defaultPush` 生产默认启用;`pushableAliases` 守卫(仅可写 store)+ offline→`deferredPushStores` 延迟重试(S17)。**F-SYNC-NOPUSH 已修复,非待办。**
- **② sync 入口 = `fabric-sync` skill(CLI 是引擎)**: skill 文档自述「CLI `fabric sync` 是事务/状态机引擎;本 skill 是它的 AI 辅助外层」。skill 流程: `store list` 枚举(仅 remote-backed 参与,local-only 跳过) → `fabric sync` 逐 store 渲染 synced/offline/conflict → 冲突时 AI 辅助 continue/abort → settle 重生 bindings 快照。**用户记忆正确**: 应走 skill,不裸操 CLI。
- **③ 顺带纠偏**: werewolf 实装 **7 个** fabric-* skill(archive/audit/connect/import/review/store/sync),AGENTS.md「Write flows 三个 Skills」文案过时(漏 audit/connect/store/sync)→ 并入 Part B F17 类「文案与实际能力不符」。
- **✅ 端到端实推已验证(2026-06-03,用户授权)**: `fabric sync` 真调 `runStartSync()`(无短路,`sync.ts:47`),team store pull--rebase 干净 + 真 `git push` 打到 `fabric-store-team-synthetic.git` → `team synced`,无 deferred/无 paused。**push 端到端实测通**(本地 0 ahead 故为 up-to-date,但 git push 实打远端需 auth,成功)。

### F28 · 🔴 HIGH(CLI/文案)· `fabric sync`/`store` 打印 stale「multi-store 未接线」警告,主动劝退用户回旧 co-location
- **来源**: 🙋 实推暴露(2026-06-03)
- **现象**: `fabric sync` 成功 `team synced` 后,仍**无条件**打印 `cli.store.experimental-unwired`:「⚠️ multi-store 仍在开发中: 挂载 store 的知识当前不会被 recall 读取, 且 sync 尚未实现 push。团队知识共享请用 co-location——把 .fabric/knowledge 提交进项目 git 仓库。」
- **核验**: 文案**逐句已被证伪** —— recall 读 store 已接线(W1-T1,scope-explain team 含 team 库)、push 已接线且实推成功(W2-T3)。这是 `fix/multistore-unwired-warning`(87ac7ae)的止血警告,接线落地后**忘了删**。
- **出处**: `packages/cli/src/commands/sync.ts:27`(`report()` 内无条件 `console.log`)+ `store.ts:69` + `store.ts:90`;文案 `i18n/locales/{zh-CN,en}.ts` 的 `cli.store.experimental-unwired`;连 `sync.ts:24-26` 的代码注释也是 stale 论断。
- **严重度**: 高 —— 不止文案不符,是**主动把用户从能用的新功能劝退回已废弃的旧模型**,与 D1/D7「砍 dual-root」方向正面冲突。本轮「怪味」最实锤体现。
- **修法**: 删除三处 `experimental-unwired` 打印 + 对应 i18n key + sync.ts 的 stale 注释(W2/W1 接线已使其失效)。零行为风险(纯删误导输出)。
- **状态**: ✅ 已确认(源码 + 实推双证)

