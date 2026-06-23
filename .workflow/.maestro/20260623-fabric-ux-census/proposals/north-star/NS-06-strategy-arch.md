# NS-06 · 策略 + 架构北极星

> 北极星 = "如果今天从零重设计 Fabric 的策略模型与内部结构,它该多简单、多自解释、多好维护"。
> 视角:维护者 + 策略透明度。授权:零用户、clean-slate、无兼容包袱。
> 输入证据:`05-strategy.md`(策略审计)/ `06-architecture.md`(架构审计)/ `00-SYNTHESIS.md`(综合)。横向先例:`maestro-flow`(阈值硬编码 / ~8 语义旋钮 / 单 scope 轴)。
> 原则:每条目标态都对照"现状证据 → 目标态 → 为什么更简单"。能写死的不暴露,能 gitignore 的不入库,能单源的不双轨。

---

## 一、策略北极星(对用户 / AI 的透明度)

策略层的北极星只有一句:**用户打开 Fabric 的任何配置/提示,不用问就懂它在干什么、为什么现在弹、为什么这条知识(没)浮现。** 当前状态的反面是:45 个旋钮看不出哪些是死的,三轴 scope 三条独立失败路径无诊断出口,self-archive 词典双轨让 AI 行为不可预测。

### 1.1 scope 模型:三维降到"一轴 + 两个内部维度"

**现状(三维全暴露给用户/AI)**:
- `semantic_scope` ∈ {team, project:<id>, personal(KP-*)} —— 可见范围
- `relevance_scope` ∈ {broad, narrow} —— 浮现时机(SessionStart vs PreToolUse)
- store 物理隔离 ∈ {team store, personal store, …N 个物理库} —— 存储位置

三个正交概念,但 `semantic_scope: team` 与 `store: team` **名字撞车语义不同**(05-strategy S6),用户面对 3×2×N 维。"为什么这条 project 知识没浮现"有三条独立失败路径(store 没绑 / semantic_scope 不匹配 / relevance=narrow 只在 edit 浮现),无统一诊断出口。

**目标模型(降维)**:

| 维度 | 现状定位 | 北极星定位 | 理由 |
|---|---|---|---|
| `semantic_scope`(team/project/personal) | 用户可见,归档时填 | **保留为唯一用户可见 scope 轴** | 这是真正的语义决策——这条知识给谁看。不可降。对齐 maestro-flow 单轴。 |
| `relevance_scope`(broad/narrow) | 用户可见,归档时还要决定 | **降为纯内部投递时机**,从用户/AI 模型中移除 | broad/narrow 本质是"SessionStart 投 vs PreToolUse 投"的实现细节;schema 已有 BM25 相关度可**自动判定** narrow 与否。归档时让用户决定一条知识是 broad 还是 narrow 是个本就难的决定(05-strategy S6)。砍掉一根可见轴。 |
| store 物理隔离 | 用户可见,与 semantic 撞名 | **重命名消歧 + 隐入引擎**:store 是物理库路由,不该和 semantic_scope 共用 "team" 词汇 | store 绑定/切换是一次性 setup(`fabric store bind/switch-write`),日常归档/recall 不该让用户再想 store。把 store 词汇改成物理名(如 `store alias` 而非 `team store`),与语义 team 解耦。 |

**降维后用户心智**:归档时只回答一个问题——"这条给谁看(team / project / personal)"。broad/narrow 由引擎按 BM25 自动定时机;store 由一次性 setup 决定,日常透明。**3 维可见 → 1 维可见**。

**诊断出口(配套,P1)**:加 `fabric doctor why-not-surfaced <id>`,对单条知识逐因回答"为什么(没)浮现":store 绑没绑 / semantic_scope 匹不匹配 / 当前是 broad 时机还是 narrow 时机。把三条失败路径收进一个 self-serve 命令。即使长期不砍 relevance 轴,这个诊断出口也立即消除"为什么这条没浮现"的最大困惑源。

---

### 1.2 旋钮北极星:45 → 最小语义旋钮集(目标 ~9 纯策略旋钮)

**现状**:`.fabric/fabric-config.json` shipped 45 key,schema ~50;纯策略阈值约 38 个,panel 仅暴露 14;含**死字段**(`cite_evict_interval`、`reverse_unarchive_*`)和已 RETIRED 仍 materialize 的 `hint_broad_budget_chars`(schema:362)。最该可见的 `nudge_mode` 在 shipped config **根本没写**,被它替代的分页旋钮全显形——可见性完全倒置(05-strategy S2/S3)。

**北极星分类处置**:

**(a) 删 — inert / 死字段(7)**
`reverse_unarchive_enabled` · `reverse_unarchive_dry_run`(未上线)· `cite_evict_interval`(已被 recall hook 取代)· `hint_broad_budget_chars`(RETIRED)· `hint_broad_top_k`(已被 backstop 取代)· `hint_broad_cooldown_hours` · `hint_narrow_cooldown_hours`(默认 0=不用)。

**(b) 写死成 const — skill 内部分页/扫描阈值(~22,YAGNI,需要再 externalize)**
全部 `import_*`(5)· `archive_max_*`(2)· `archive_digest_max_sessions` · `review_topic_result_cap` · `review_stale_pending_days` · `hint_summary_max_len` · `hint_reminder_to_context` · `hint_narrow_top_k` · `hint_narrow_dedup_window_turns` · `broad_index_backstop` · `conflict_lint_similarity_threshold` · `cite_recall_window_minutes` · `selection_token_ttl_ms` · `plan_context_top_k` · `recall_relevance_ratio` · `fabric_event_retention_days` · `orphan_demote_*`(3)· `embed_weight` · `embed_model`。
依据:schema 注释自陈这些是 "rule-of-thumb" / "pagination knob",无真实用户报告需调。对照 maestro-flow:注入预算(50/35/25%)、credibility 半衰期全部硬编码,可行且更干净。

**(c) 合并入 `nudge_mode`(音量类,~6)**
`archive_hint_cooldown_hours` · `maintenance_hint_cooldown_days` · `hint_dismiss_signals` · `archive_hint_hours`(已被 backlog 取代)· `underseed_node_threshold`(归一个 import 开关)· `cite_recall_nudge`(归 `cite_policy_enabled`)。这些都是"多吵"维度,归 nudge_mode 总闸统管。

**(d) 保留 — 最小语义旋钮集(~9 纯策略 + 状态/红线)**

| 旋钮 | 语义 | 为什么保留 |
|---|---|---|
| `nudge_mode` | 人类输出量总闸 silent/minimal/normal/verbose | **唯一可见量表盘**(见 1.2 末) |
| `default_layer_filter` | recall 默认层 team/personal/both | 语义性选择,非阈值 |
| `audit_mode` | doctor 严格度 strict/warn/off | 红线/严格度档位 |
| `embed_enabled` | dense 向量检索开关 | 重大能力开关(连带 embed_weight/model) |
| `archive_edit_threshold` | Signal A 编辑数触发判据 | "何时算够"——触发判据非音量,与 nudge_mode 正交 |
| `review_hint_pending_count` | Signal B pending 数判据 | 同上,且三处对齐最透明 |
| `review_hint_pending_age_days` | Signal B pending 龄判据 | 同上 |
| `maintenance_hint_days` | Signal D 距上次 doctor 判据 | 同上 |
| `cite_nudge_ignore_globs` | cite 豁免 glob | 语义性豁免,非阈值 |
| `cite_policy_enabled` / `self_archive_policy_enabled` | 两条强策略红线 escape hatch | 保留关停权 |
| `onboard_slots_opted_out` | 已 dismiss 的 onboard slot | 状态非旋钮 |

**净效果**:schema ~50 → ~24(含身份/路由/管道 ~12)· **纯策略旋钮 38 → ~9** · **shipped config 45 → ~18 key**。install 时只 materialize 最小集 + 身份/路由,不再写全部默认(终结"旋钮汤"观感)。删 schema 字段零迁移成本:root 已是 lenient parse,旧 key 自动丢弃。

**`nudge_mode` 提为唯一可见量表盘(P1)**:install 默认写进 shipped config(带注释),作为人类输出的**唯一**量闸。区分两类旋钮——"音量"(归 nudge_mode)vs"触发判据"(edit_threshold / pending_count / pending_age / maintenance_days,正交保留)。终结"总表盘 + 全部被替代旋钮并存"的双轨(现状两套并存,override 优先级是又一条隐性规则)。

---

### 1.3 策略自解释:规则随提示自带"为什么"

**北极星**:用户永远不需要去读 hook 源码注释才懂一条规则。三条最不透明的规则(05-strategy 透明度专项)的自解释方案:

| 不透明规则 | 现状(埋在哪) | 自解释目标态 |
|---|---|---|
| **archive_backlog "死 session" 全套判定**(session_ended∨idle≥24h、死 session≥2、anti-loop 12h、high-value gate 7 词+3 event) | 全硬编码在 `fabric-hint.cjs:597-644`,用户只看到"建议归档" | nudge 文案自带来源:"来自 N 个已结束会话的未归档工作(最近:<session 简述>)";`fabric doctor` 暴露 backlog 明细 |
| **scope 三轴为何(不)浮现** | bootstrap:89 + `broad.cjs:798/931`,三失败路径无诊断 | `fabric doctor why-not-surfaced <id>` 逐因回答(见 1.1) |
| **self-archive normative 词典双轨**(bootstrap 5 词 vs hook 7 词) | bootstrap:101 列 5 个,hook `fabric-hint.cjs:233` 用 7 个,AI 自触发模型≠系统观测模型 | **单一 shared 常量**,hook + bootstrap 渲染同源 + parity 测试(已有 CJS twin 基础设施 `cite-line-parser.cjs:31`) |

**第四条 self-explain(cite 记账可观测性,P2)**:`fabric doctor --cite-coverage` 现状只吐一个汇总百分比,用户不知某 edit 为何没算进覆盖率。目标态输出**逐条 miss 原因**(no-recall / window-expired / path-mismatch / exempt),让黑箱可行动。

**S1 语言字段 drift(P0,确凿 bug)**:bootstrap:93/161 教 AI/用户去 `.fabric/fabric-config.json#fabric_language` 找/设语言,但该字段已搬到 `~/.fabric/fabric-global.json#language`,root parser **静默丢弃**旧 key(改了不报错也不生效)。byte-locked bootstrap 把过期事实固化成契约。改两行指向机器级 global + 同步 doctor drift 基线。**价值高成本极低,北极星里它是 P0 起点。**

**自解释设计律(贯穿)**:凡是"提示/nudge"都必须**自带触发理由**(为什么现在弹 + 来自哪);凡是"用户可见旋钮"都必须**能在 panel 一句话说清影响什么行为**(说不清 → 它就该写死或归 nudge_mode)。这条律本身就是判断"该不该暴露一个旋钮"的北极星标尺。

---

## 二、架构北极星(对维护者)

架构层北极星一句话:**单一真源,派生物不入库,逻辑不双写。** 当前所有维护税都源自两个反模式——"把派生物当真源进版本控制"(镜像 5 份)+ "用第二套 cjs 平行实现 TS 逻辑"(hook 1336 行)。这两个根因制造了补偿性 lint(49 个 check 过半是镜像/派生状态的税)和一致性人肉义务(events.jsonl 双语言写)。

### 2.1 单一真源:四个收敛

**(1) 镜像 5 → 1(P0,最高价值÷成本)**
现状:每个 hook/skill 有 5 份副本全进 git——真源 `packages/cli/templates/` + 4 套 dogfood 自装产物(`.claude/` `.codex/` `packages/cli/.claude/` `packages/cli/.codex/`)。md5 靠"刚 install-sync 过"维持一致,**集合已实测漂移**:`archive-hint.cjs` 仅 1/5、`summary-fallback.cjs` 仅 2/5、`cite-contract-reminder.cjs` 4/5 且独缺真源,文件数 16/17/17/17/18 无一相同(06-arch §1)。
目标态:**4 套 dogfood 自装产物 `.gitignore` + `git rm --cached`,只留 `packages/cli/templates/` 唯一真源进 git**。它们本就是 `fabric install` 可重生的派生物。代价近乎零,收益:git diff 5x→1x,集合漂移**结构上不可能再发生**(产物不入库),连带删一批 `*Drift`/`SkillRefMirror`/`LegacyClientPath` lint。

**(2) cjs/TS 双运行时收敛:hook 逻辑从 TS 单源生成(P1)**
现状:`knowledge-hint-broad.cjs` 1336 行独立 cjs,渲染(`renderFull/Truncated/Summary/Banner`)在 hook 本地重实现,`fabric context` 命令反向 require cjs 才能字节一致——**真源在 cjs、TS 命令反向复用,认知倒置**(06-arch §3)。`lib/` 下还有 14 个 cjs(config 解析 / 状态存储 / i18n),是一整套与 TS 平行的第二运行时。约束真实:client hook 必须自包含 cjs、不能依赖 TS build。
目标态:**渲染/逻辑真源写在 `shared`(纯函数无 fs),用 esbuild/tsup `--format=cjs` bundle 成单文件 cjs 注入 `templates/hooks/`**。`fabric context` 直接 import TS 版,hook 用 bundle 版——**同一真源两个产物,字节一致由同源编译保证**而非反向 require。`templates/hooks/` 从"手写源"变"dist 产物"。消灭手写第二运行时是维护负担最大单一来源的根治。

**(3) events.jsonl 写入统一过 schema(P1)**
现状:`events.jsonl` 是 cjs(6+ hook)与 TS(server tools)**双语言双写者**共享 append-only ledger,共享 `event-ledger.ts` schema 但 **cjs 侧手拼 JSON 不过 Zod**;加事件类型要改 shared schema + rebuild dist + 6 处 cjs 手拼,漏一处静默写非法事件直到 doctor 才发现(06-arch §2)。
目标态:**hook 侧所有 append 走单一 `lib/event-append.cjs`,该 cjs 从 shared event schema 构建时 codegen 出 guard**(Zod 校验逻辑 → cjs guard)。6 处手拼 → 1 个生成的 helper,cjs 侧也有 schema 守门。一致性从人肉变构建保证。

**(4) shared dist rebuild 根治:exports.development 走 src(P1)**
现状:`shared/package.json` exports 全指 `./dist/*`,server 68 文件消费 dist 不消费 src;改一行 schema 必须手动 `pnpm --filter @fenglimg/fabric-shared build`,忘则 server 跑旧 dist——rc.21/24/29 三次复发(06-arch §6)。
目标态:**`shared/package.json` 加 `exports` 的 `development` condition(或 tsconfig `paths`)让 dev/test 直接解析 `shared/src/*.ts`**(vitest+tsx 原生支持);只有 `pnpm pack`/发布才走 dist。消除 dev 阶段 rebuild 步骤,结构性根治整类复发 release bug。

---

### 2.2 目标内部结构图(文字版)+ 现状对比

**现状结构(06-arch §0 摘要)**:真源散在 `shared`(schema+文案)和 `cli/templates`(hook+skill 镜像源)两处;server 经 dist 消费 schema;hook 是独立 cjs 既 spawn CLI 又本地重渲染;`.fabric/*.jsonl` 是 cjs+TS 双方追加的共享 ledger;5 份镜像入 git。

**目标结构(北极星)**:

```
┌──────────────────────────────────────────────────────────────┐
│  真源层 (authored, 唯一)  packages/shared/src/                  │
│   ├ schemas/         (Zod: config / event-ledger / bindings)   │   ← 唯一 schema 真源
│   ├ templates/       (bootstrap-canonical 文案真源)             │   ← 唯一文案真源
│   ├ render/          (纯函数渲染逻辑, 无 fs ← 新增)              │   ← 唯一渲染真源 (从 cjs 上移)
│   └ codegen/         (config-defaults / event-guard / 关键词集) │   ← 单源, 生成 cjs
└───────────────┬──────────────────────────────────────────────┘
                │  dev: exports.development → 直解析 src (零 rebuild)
                │  publish: tsup build → dist/
   ┌────────────┼───────────────────────────┬────────────────────┐
   │            │                           │                    │
┌──▼────────┐  ┌▼──────────────┐    ┌────────▼─────────┐         │
│ cli       │  │ server (MCP)   │    │ esbuild bundle    │         │
│ install/  │  │ import src(dev)/│   │ shared/render +   │         │
│ doctor/   │  │ dist(pub)       │   │ codegen → 单文件   │         │
│ context   │  │ doctor lints    │   │ cjs               │         │
│ (import   │  │ (注册表驱动)     │   └────────┬──────────┘         │
│  shared   │  └─────────────────┘            │ 产出              │
│  render)  │                                 ▼                   │
└──┬────────┘              packages/cli/templates/  ← 唯一入库真源  │
   │                        hooks/*.cjs (= bundle 产物, 薄 shim)   │
   │ install 拷贝              skills/*/SKILL.md                    │
   ▼
<repo>/.claude/ + .codex/   ← .gitignore (派生物, install 可重生)
   hooks/*.cjs  skills/*

运行时数据流 (.fabric/ 派生状态):
   hooks .cjs ─┐
               ├─ via lib/event-append.cjs (codegen guard) ─▶ events.jsonl
   server   ───┘                                              (单一 schema-guarded 写路径)
   cli install ──▶ bindings-snapshot ──▶ hooks 读 (单写者, 已健康)
   cli scanner ──▶ forensic.json
   server/cli  ──▶ metrics.jsonl
```

**目标态层 / 依赖 / 数据流 / 派生状态谁建**:
- **层**:真源层(shared/src,唯一)→ 消费层(cli/server)→ 编译产物层(templates = bundle 产物)→ 运行时(用户仓 .claude/.codex,gitignore)。
- **依赖**:dev 阶段 cli/server 直接吃 shared/src(零 rebuild);hook 不再有自己的逻辑,只是 shared/render+codegen 的 bundle 产物。
- **数据流**:events.jsonl 唯一 schema-guarded 写路径(cjs 经 codegen guard,TS 经 Zod);bindings-snapshot 单写者(已健康,保留)。
- **派生状态谁建**:全部 `.fabric/*.jsonl` + 4 套镜像 = 引擎/install 重建,**全 gitignore**;入 git 的只有 shared/src(真源)+ cli/templates(编译产物,可由 CI 校验同源)。

**对比要点**:现状两处真源(shared + templates 手写)→ 目标一处真源(shared/src,templates 降为产物);现状 cjs 手写逻辑 → 目标 cjs 是 bundle;现状 events 双语言手拼 → 目标单 guarded 路径;现状 5 份入 git → 目标 1 份。

---

### 2.3 retired-reference lint:把"删了 X 谁还引用 X"做成 doctor 闸

**根因(00-SYNTHESIS T1)**:Fabric 自己是知识层,却没有"改了 X、谁还引用 X"的反查。P0-1(narrow hook 指退役工具 `fab_plan_context`)、P0-2/S1(bootstrap 指已删 `fabric_language` 字段)都是同一类症状——**契约分波次改造缺 stale-pointer 扫描闸**。

**目标设计(`createRetiredReferenceCheck`,P1)**:

1. **退役物清单(单一登记处)**:维护一份 `retired-registry`(shared 内),登记已退役的 **MCP 工具名**(`fab_plan_context`…)、**config 字段**(`fabric_language`、`cite_evict_interval`、`hint_broad_budget_chars`…)、**命令/skill**。退役一个东西 = 往登记处加一项(而非散落在各处删)。
2. **扫描面**:doctor 遍历 `templates/hooks/*.cjs` 文案 + `bootstrap-canonical.ts` + `skills/*/SKILL.md` + server instructions,grep 是否仍出现登记表里的退役标识符。
3. **闸**:命中即 fail(audit_mode strict)/ warn,报告"`<file:line>` 仍引用已退役的 `<id>`(退役于 <ref>)"。
4. **与现有测试呼应**:已有 `index.test.ts:72` 断言 server instructions `.not.toContain("fab_plan_context")` —— 这正是手写版的 retired-reference 检查,目标是**把这种一次性断言泛化成登记表驱动的 lint**,覆盖全部触点而非逐个打地鼠。
5. **跨后缀普查**(吸取 cleanup grep 盲区教训):扫描必须覆盖 `.cjs` + `.ts` + `.md` 全后缀 + 4 套已安装副本(若副本仍入库期间),用正向白名单不用排除式 grep。

**价值÷成本**:价值高(根治 P0-1/P0-2 整类 stale pointer,不再每次退役都人肉打地鼠)/ 成本中(一个 lint + 登记表)。

---

## 三、排序:策略 + 架构收敛清单(价值÷成本 + P0/P1/P2)

> 排序键:价值÷成本优先,结构根因(消掉一批下游税的)优先于点修。波次沿用 SYNTHESIS 的 W0–W3。

### P0 — 立即(分钟级,已验证,正在持续误导 / 几乎零成本砍大头)

| # | 收敛项 | 线 | 价值÷成本 | 依据 |
|---|---|---|---|---|
| P0-1 | **镜像 5→1**:4 套 dogfood 产物 `.gitignore`+`git rm --cached`,只留 templates | 架构 | 极高÷极低 | 06-arch §1 / SYNTHESIS #9。集合漂移结构上消失,连带删一批 drift lint。**架构 Top1 重构。** |
| P0-2 | **bootstrap 语言字段 drift 修正**:bootstrap:93/161 指向 `~/.fabric/fabric-global.json#language` + 同步 doctor drift 基线 | 策略 | 高÷极低 | 05-strategy S1 / SYNTHESIS P0-2。2 行,正在误导每个会话的 AI。 |
| P0-3 | **删 narrow hook 退役工具尾行**(`fab_plan_context`)改真源后 `fabric install` 同步 | 策略/架构 | 高÷低 | SYNTHESIS #1。与 P0-1 同步链一起验证。 |

### P1 — 结构根治(本轮,消掉一大批维护税)

| # | 收敛项 | 线 | 价值÷成本 | 依据 |
|---|---|---|---|---|
| P1-1 | **shared `exports.development` 走 src 免 rebuild** | 架构 | 高÷中 | 06-arch §6。根治 rc.21/24/29 三复发整类 bug。独立可先做。 |
| P1-2 | **旋钮瘦身 45→~18 key**(删 7 inert + 写死 ~22 + 合并 ~6)+ shipped config 只 materialize 最小集 | 策略 | 高÷中 | 05-strategy S2。lenient parser 零迁移。config 认知负担腰斩。 |
| P1-3 | **`nudge_mode` 提为唯一可见量表盘**,写进 shipped config + 删冷却类音量旋钮 | 策略 | 高÷中 | 05-strategy S3。终结双轨,可见性归位。**策略最该简化的一处。** |
| P1-4 | **retired-reference lint**(登记表驱动,扫 hooks/bootstrap/skill/server) | 架构/策略 | 高÷中 | SYNTHESIS T1。根治 P0-2/P0-3 整类 stale pointer。 |
| P1-5 | **self-archive normative 词典单源化**(shared 常量 + 渲染同源 + parity 测试) | 策略 | 中高÷低 | 05-strategy S5。已有 CJS twin 基础设施。消除 AI 行为不可预测。 |
| P1-6 | **hook 渲染逻辑真源归 TS、cjs 由 esbuild bundle**(消灭 1336 行平行运行时) | 架构 | 高÷中高 | 06-arch §3。维护负担最大单源根治;做完连带 §4 半数 lint 消失。 |
| P1-7 | **events.jsonl 写入收敛单 helper + cjs schema guard codegen** | 架构 | 中高÷中 | 06-arch §2。events 一致性人肉→构建保证。 |
| P1-8 | **`why-not-surfaced <id>` 诊断 + scope 三因决策表入 bootstrap** | 策略 | 高÷低 | 05-strategy S6。三轴失败路径给 self-serve 出口(不依赖砍轴)。 |

### P2 — 大重设计 / 探索(需逐项拍板)

| # | 收敛项 | 线 | 价值÷成本 | 依据 |
|---|---|---|---|---|
| P2-1 | **scope 砍 relevance 轴**:broad/narrow 从用户可见模型降为纯内部投递时机(BM25 自动判定) | 策略 | 高÷高 | 05-strategy S6。需评估归档/注入链路。降一根可见轴。 |
| P2-2 | **doctor lint 注册表化** 49 check → 数组+元数据驱动;随 P0-1/P1-6 自然瘦身到 ~30 | 架构 | 中÷中 | 06-arch §4。加 lint 从碰 3-5 处变加 1 项。P0-1/P1-6 做完大半自动达成。 |
| P2-3 | **config 默认值 codegen 到 cjs**(`config-defaults.cjs`),消除 hook 裸 JSON 解析漂移 | 架构 | 中÷低中 | 06-arch §5。与 P1-7 codegen 管线复用。 |
| P2-4 | **`--cite-coverage` 输出逐条 miss 原因**(no-recall/window-expired/path-mismatch/exempt) | 策略 | 中÷中 | 05-strategy S7。cite 记账黑箱可行动。 |
| P2-5 | **injections.jsonl 与 events.jsonl 重叠审查**,能合则合少一套读写 | 架构 | 中÷中 | 06-arch §2。 |

**收敛逻辑(核心洞察)**:P0-1(镜像)+ P1-6(平行运行时)是同一根因"派生物当真源 + cjs 双写"的两切面——先做 P0-1(零成本砍 80% 镜像),再做 P1-6(消灭平行运行时),则 P2-2 的一半 doctor lint **自动消失**(它们是镜像/派生状态的补偿税)。P1-1(exports.development)独立但因三复发、价值÷成本最优,与 P0-1 并列先做。策略侧 P1-2/P1-3 是同一动作两面(瘦身 + nudge_mode 归位),一并落。
