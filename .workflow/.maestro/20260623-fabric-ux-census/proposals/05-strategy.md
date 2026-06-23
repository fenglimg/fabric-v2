# 05 · 整体策略透明度审计 (Strategy Layer)

审计对象:Fabric 的"策略层"——归档 cadence、self-archive (E3)、cite 记账、pending 积压提示、scope 三轴模型、20+ config 旋钮。
基调:交互体验(透不透明/看不看得懂/可不可预测) × 策略本身(设计/阈值/复杂度)双角度。零用户、激进授权。
C1 基线已读(2 字段模型 / cite 自动记账 / self-archive marker-free / dual-anchor nudge),本审**不重复 C1 已做**,只审当前状态找新问题。
横向参照:`/Users/wepie/Desktop/personal-projects/maestro-flow`。

---

## Census 表 1:Config 旋钮全集

来源:`packages/shared/src/schemas/fabric-config.ts`(schema 真源)+ `.fabric/fabric-config.json`(本仓 shipped)+ `packages/shared/src/schemas/fabric-config-introspect.ts:220`(panel 暴露集)。

图例 —— **Panel?**:`fabric config` 交互面板是否暴露(Y=用户能在 TUI 改 / J=仅 JSON 手改)。**砍?**:✂=建议删/写死 · 合=建议合并 · 留=保留。

### 身份/路由(非阈值,引擎管理,不计入"旋钮负担")
| key | 管什么 | 默认 | Panel? |
|---|---|---|---|
| project_id / workspace_binding_id / active_project | 项目身份 | — | J(引擎写) |
| required_stores / active_write_store / write_routes / default_write_store | store 读写路由 | — | J(`store` 命令写) |
| default_layer_filter | recall 默认层 team/personal/both | both | Y |

### Group B:hint 阈值(panel 暴露 8 个)
| key | 管什么 | 默认 | 用户能懂? | 砍? |
|---|---|---|---|---|
| archive_hint_hours | Signal A 时间分支(距上次 proposed N 小时) | 24 | 否(已被 crack2 backlog 取代,见下) | ✂ |
| archive_hint_cooldown_hours | 任一 signal 触发后静默小时 | 12 | 勉强 | 合(→nudge_mode) |
| archive_edit_threshold | Signal A 编辑数分支 | 20 | 是 | 留 |
| underseed_node_threshold | import signal:canonical < N 才提示 | 10 | 勉强 | 合 |
| review_hint_pending_count | Signal B:pending ≥ N 提示 review | 10 | 是 | 留 |
| review_hint_pending_age_days | Signal B:最早 pending ≥ N 天 | 7 | 是 | 留 |
| maintenance_hint_days | Signal D:距上次 doctor N 天提示 | 14 | 是 | 留 |
| maintenance_hint_cooldown_days | Signal D 冷却 | 7 | 勉强 | 合 |

### Group D 行为开关(panel 暴露 2 个)
| key | 管什么 | 默认 | 用户能懂? | 砍? |
|---|---|---|---|---|
| nudge_mode | 人类输出量总闸 silent/minimal/normal/verbose | normal | 是(最该暴露) | 留(升为唯一量闸) |
| embed_enabled | dense 向量检索开关 | false | 是 | 留 |

### Group C
| key | 管什么 | 默认 | 砍? |
|---|---|---|---|
| audit_mode | doctor 严格度 strict/warn/off | — | 留 |

### Group D/E "power user 仅 JSON"(panel 不暴露 ~36 个)—— 旋钮瘦身主战场
| key | 管什么 | 默认 | 砍? |
|---|---|---|---|
| import_window_first_run_months | import 首跑扫描月数 | 60 | ✂ 写死 |
| import_window_rerun_months | import 重跑扫描月数 | 2 | ✂ 写死 |
| import_max_pending_per_run | import 单次 pending 上限 | 10 | ✂ 写死(=review_hint_pending_count) |
| import_max_commits_scan | import 扫描 commit 上限 | 500 | ✂ 写死 |
| import_skip_canonical_threshold | canonical ≥N 时 import 前置警告 | 50 | ✂ 写死 |
| archive_max_candidates_per_batch | archive 单批候选数 | 8 | ✂ 写死 |
| archive_max_recent_paths | archive 上下文路径数 | 20 | ✂ 写死 |
| archive_digest_max_sessions | archive digest 历史 session 数 | 10 | ✂ 写死 |
| review_topic_result_cap | review 每 topic 结果数 | 8 | ✂ 写死 |
| review_stale_pending_days | review 视 pending 为 stale 的天数 | 14 | 合(→review_hint_pending_age_days) |
| reverse_unarchive_enabled / _dry_run | 反归档原语开关(inert) | false | ✂ 删(未上线) |
| cite_evict_interval | 旧 turn-counter cite 提醒(inert) | 0 | ✂ 删(已被 recall hook 取代) |
| cite_recall_nudge | cite 软提示总开关 | true | 合(→nudge_mode/cite_policy_enabled) |
| cite_recall_window_minutes | recall 算作"为此 edit"的回看窗 | 30 | ✂ 写死 |
| cite_nudge_ignore_globs | cite 豁免 glob | — | 留(语义性,非阈值) |
| conflict_lint_similarity_threshold | 冲突 lint BM25 相似阈 | 0.5 | ✂ 写死 |
| onboard_slots_opted_out | 已 dismiss 的 onboard slot | [] | 留(状态非旋钮) |
| hint_broad_top_k | SessionStart broad banner topK | 8 | ✂ 写死(已被 broad_index_backstop 取代) |
| hint_broad_budget_chars | **已 RETIRED**(schema:362) | 2000 | ✂ 删(死字段仍在 shipped file) |
| broad_index_backstop | broad index 折叠行数 | 50 | ✂ 写死 |
| hint_narrow_top_k | narrow PreToolUse hint topK | 5 | ✂ 写死 |
| hint_narrow_dedup_window_turns | narrow 同文件去重窗 | 5 | ✂ 写死 |
| hint_broad_cooldown_hours | broad 重发冷却 | 0 | ✂ 删(默认 0=不用) |
| hint_narrow_cooldown_hours | narrow 重发冷却 | 0 | ✂ 删(默认 0=不用) |
| hint_summary_max_len | 条目 summary 截断长 | 80 | ✂ 写死 |
| hint_reminder_to_context | hint 走 additionalContext vs stderr | true | ✂ 写死(false 是降级模式) |
| hint_dismiss_signals | 永久静默某 signal 类型 | — | 合(→nudge_mode + per-signal) |
| cite_policy_enabled | cite 策略总开关 | true | 留(红线 escape hatch) |
| self_archive_policy_enabled | self-archive 总开关 | true | 留(红线 escape hatch) |
| fabric_event_retention_days | ledger 轮转保留天 7/30/90 | (lib 30) | ✂ 写死 |
| orphan_demote_{proven,verified,draft}_days | orphan 降级天阈 ×3 | (doctor 默认) | ✂ 写死 |
| selection_token_ttl_ms | plan_context token TTL | (lib 5min) | ✂ 写死 |
| plan_context_top_k | recall 候选上限 | (lib 24) | ✂ 写死 |
| recall_relevance_ratio | recall 相关度地板 α | (lib 0.25) | ✂ 写死 |
| mcpPayloadLimits / scanIgnores / clientPaths | 管道配置 | — | 留(基础设施) |
| embed_weight / embed_model | 向量权重/模型 | 30 / bge-zh | 合(随 embed_enabled) |

**计数**:schema ~50 key,身份/路由/管道占 ~12,**纯策略阈值旋钮约 38 个**,panel 仅暴露 14。其中 **23 个标 ✂(删/写死)**。

---

## Census 表 2:隐性策略规则(散在 hook/bootstrap 的 if/阈值,用户在 config 里看不到)

来源:`packages/cli/templates/hooks/fabric-hint.cjs`、`cite-policy-evict.cjs`、`knowledge-hint-broad.cjs`、bootstrap。

| 隐性规则 | 来源 file:line | 阈值/逻辑 | 用户可见? |
|---|---|---|---|
| Signal 优先级 archive > backlog > review > import | fabric-hint.cjs:966 / 1057 | 硬编码 precedence | 否 |
| archive_backlog "死 session" 判定 | fabric-hint.cjs:597 / 624 | session_ended **或** idle ≥24h | 否 |
| backlog 触发死 session 数 | fabric-hint.cjs:535 | DEFAULT=2(无 config) | 否 |
| backlog anti-loop 冷却 | fabric-hint.cjs:534 | 12h 硬编码 | 否 |
| archive 高价值 gate(value-gate) | fabric-hint.cjs:228-241 | 3 个 event type + 7 个 normative 关键词 | 否 |
| normative 关键词集(self-archive 触发) | fabric-hint.cjs:233 / bootstrap:101 | 以后/always/never/下次/记一下/from now on/永远不要 | 半(bootstrap 列一部分,与 hook 不完全一致) |
| Signal A 需有 knowledge_proposed anchor 才触发 | fabric-hint.cjs:949-951 | 无 anchor → 永远静默(交给 Signal C) | 否 |
| maintenance signal 最小 canonical 门 | fabric-hint.cjs:361 | canonical ≥5 才提示跑 doctor | 否 |
| underseed 触发的三 AND 条件 | fabric-hint.cjs:1152-1156 | <阈 AND init≥24h AND 无 proposed 24h | 否 |
| import in-flight 静默 Signal B | fabric-hint.cjs:763-771 | .import-state.json + 24h TTL | 否 |
| cite recall 窗口 | cite-policy-evict.cjs:74 | 30min(=config 但默认隐) | 半 |
| cite path overlap 判定 | cite-policy-evict.cjs:266 | 相等/路径边界后缀/祖先目录 | 否 |
| cite 默认豁免 glob | cite-policy-evict.cjs:111 | `.workflow/**` | 否 |
| broad banner TRUNCATION_THRESHOLD | knowledge-hint-broad.cjs(注 359) | 12(grouped render 触发) | 否 |
| nudge_mode 各级语义 | fabric-config.ts:65-73 | silent/minimal/normal/verbose 的具体行为 | 否(仅 schema 注释) |

---

## 逐策略审计

### S1 · Bootstrap 把"语言来源"指错(确凿 drift bug)
**现状**:bootstrap `BOOTSTRAP_CANONICAL_ZH:93` / `_EN:161` 写:
> Language:渲染按 `.fabric/fabric-config.json` 的 `fabric_language` 字段。

但同包 schema `fabric-config.ts:150-153` 明确:`fabric_language` **已不是 per-project 字段**,language 现在唯一住在 `~/.fabric/fabric-global.json#language`,root parser 会**静默丢弃**遗留的 `fabric_language` key。

**问题**(透明度):bootstrap 是"给 AI 读的行为规约",这条直接教 AI/用户去一个**已被删除**的字段找/设语言。byte-locked 的 bootstrap 反而把过期事实固化成"契约"。任何照做的人改了个被静默吞掉的 key,行为不变,且无报错——典型的"看得懂但是错的"。

**方案**:改两行为「Language:由机器级 `~/.fabric/fabric-global.json` 的 `language` 决定,用 `fabric config` 改」。属 byte-lock 内容,需同步改 doctor drift 对照基线(canonical 改了它就该改)。
**价值÷成本**:价值高(消除一条会误导 AI 的硬伤),成本低(2 行 + 测试基线)。**P0**。

### S2 · 旋钮过度可配置:38 个阈值旋钮,23 个该写死/删
**现状**:`fabric-config.ts` 暴露 ~38 个纯策略阈值旋钮。其中一大类是 skill 内部分页/扫描上限(`import_max_commits_scan=500`、`archive_max_candidates_per_batch=8`、`archive_digest_max_sessions=10`、`review_topic_result_cap=8`…),全部 schema 注释自陈"rule-of-thumb""pagination knob"。另有**纯死字段仍在 shipped config**:`.fabric/fabric-config.json` 仍 materialize `hint_broad_budget_chars`(schema:362 自陈 RETIRED)。

**问题**:
- 交互角度:用户打开 config 文件看到 45 个 key,无法判断哪些影响行为、哪些是死的、哪些只是 skill 分页。可配置 ≠ 可理解;这是"旋钮汤"(schema:71 自己用了 "knob soup" 这个词)。
- 策略角度:这些 ✂ 旋钮的"可调"价值几乎为零——没有真实用户报告过要把 `archive_digest_max_sessions` 从 10 调到别的值。它们是过度防御(rc.9 一次性把所有 hardcode 都 externalize)的产物。

**方案(激进)**:
1. **删 inert**:`reverse_unarchive_*`、`cite_evict_interval`、`hint_broad_budget_chars`、`hint_broad_top_k`(已被 backstop 取代)。
2. **写死**:全部 `import_*`、`archive_max_*`、`archive_digest_*`、`review_topic_*`、`hint_*_cooldown_hours`(默认 0)、`hint_summary_max_len`、`hint_reminder_to_context`、`conflict_lint_similarity_threshold`、`selection_token_ttl_ms`、`plan_context_top_k`、`recall_relevance_ratio`、`fabric_event_retention_days`、`orphan_demote_*`、`cite_recall_window_minutes`、`broad_index_backstop`。改回 const,需要时再 externalize(YAGNI)。
3. **最小旋钮集(推荐保留 ~10)**:`default_layer_filter`、`nudge_mode`、`audit_mode`、`embed_enabled`、`archive_edit_threshold`、`review_hint_pending_count`、`review_hint_pending_age_days`、`maintenance_hint_days`、`cite_policy_enabled`、`self_archive_policy_enabled`、`cite_nudge_ignore_globs`(语义豁免)。其余全砍。
4. **shipped config 瘦身**:install 时只写最小集 + 身份/路由,不再 materialize 全部默认(现在写 45 个 key 制造"旋钮汤"观感)。

**对照 maestro-flow**:它的注入预算(context-budget.ts:40 的 50/35/25% 三档)、credibility 半衰期(60/30/180 天)**全部硬编码**,用户面只剩 ~8 个语义性 specInjection 旋钮(category/keyword 映射)。证明"阈值硬编码 + 只暴露语义配置"是可行且更干净的路线。Fabric 反向走到了极端可配置。
**价值÷成本**:价值高(config 从 45→~15 key,认知负担腰斩),成本中(删 schema 字段需保 lenient parse 向后兼容——已是 lenient root,删了旧 key 自动丢弃,零迁移)。**P0**。

### S3 · nudge_mode 与旧数字旋钮"双轨"——最该暴露的反而在 shipped file 缺席
**现状**:schema:59-73 引入 `nudge_mode` 作为"knob soup 的替代单一表盘",但 71-72 行又说旧数字旋钮"retained as fine-grained OVERRIDES"。而本仓 `.fabric/fabric-config.json` **根本没有 `nudge_mode` 这一行**(45 个 key 里没有它),却 materialize 了它要替代的全部旧旋钮。

**问题**:
- 设计角度:既引入总表盘又保留全部被替代旋钮 = 两套并存的心智模型,override 优先级(旋钮 win over preset)是又一条隐性规则(表 2)。"替代"没真正发生。
- 交互角度:用户打开 config 看到 8 个 hint 阈值,看不到那个本应统管它们的 `nudge_mode`。最重要的 UX 表盘隐形,最不重要的分页旋钮显形——可见性完全倒置。

**方案**:把 `nudge_mode` 作为人类输出的**唯一**量闸,install 默认写进 shipped config(带注释);删除 `archive_hint_cooldown_hours`、`maintenance_hint_cooldown_days`、`hint_dismiss_signals`、`hint_*_cooldown_hours` 这些"音量"性旋钮(它们都是 nudge_mode 该统管的维度)。保留的是"**触发判据**"旋钮(edit_threshold / pending_count / pending_age / maintenance_days),它们是"何时算够"而非"多吵",与 nudge_mode 正交,不冲突。
**价值÷成本**:价值高(消灭双轨,可见性归位),成本中。**P1**。

### S4 · pending 积压策略:阈值合理,但">10"在两处来源且口径漂移
**现状**:bootstrap:95/163 告诉 AI「pending >10 主动 propose review」;hook `fabric-hint.cjs:319` `DEFAULT_REVIEW_HINT_PENDING_COUNT=10`;config `review_hint_pending_count=10`。三处一致 ✓。但 `review_stale_pending_days=14`(config)与 Signal B 的 `review_hint_pending_age_days=7` 是**两个不同的"陈旧"定义**:hook 在 7 天提示 review,skill 内部在 14 天才视为 stale。

**问题**(透明度):同一概念"pending 太旧了"有 7 天和 14 天两个数,分属 hook 和 skill,用户无从知道哪个在起作用。schema:271-275 注释自陈 review 的 14 比 Signal B 的 7 更松"because review specifically targets the long tail"——这是合理设计,但**完全埋在代码注释里**,bootstrap/config 都没讲。

**方案**:阈值 10/7 保留(合理)。把 `review_stale_pending_days` 合并掉或在 panel description 里点明二者关系。pending 积压策略整体是本类**最透明**的一条(三处数字对齐),小修即可。
**价值÷成本**:价值中,成本低。**P2**。

### S5 · self-archive 触发(E3):normative 关键词集 hook/bootstrap 不一致
**现状**:bootstrap:101 列触发关键词「以后/always/never/下次/记一下」(5 个);hook value-gate `fabric-hint.cjs:233` 的 `ARCHIVE_NORMATIVE_KEYWORDS` 列「以后/always/never/from now on/下次/记一下/永远不要」(7 个)。两边交集但不相等——bootstrap 少了 `from now on` 和 `永远不要`。

**问题**:
- 透明度:AI 读 bootstrap 学到 5 个词,而真正决定 backlog value-gate 是否点亮的 hook 用 7 个词。AI 的自触发模型和系统的观测模型**用不同的词典**,行为不可完全预测(用户说 "from now on" AI 可能不自触发,但 hook 会认为有高价值信号)。
- 策略角度:self-archive 是"强行为策略"(schema:381 自称可能让 agent 像"stubborn parrot"),触发词的准确性直接影响误触发率,两套词典是真实风险。

**方案**:把关键词集抽成**单一 shared 常量**(CJS twin 模式已在用,见 cite-line-parser.cjs:31),hook 和 bootstrap 渲染同一来源。bootstrap 里改成"见 fabric-review 的 ref"或直接列全 7 个并保证同步测试(类似已有的 G-PARITY byte-lock 测试)。
**价值÷成本**:价值中高(消除行为不可预测的根因),成本低(已有 twin 基础设施)。**P1**。

### S6 · scope 三轴模型:概念正确但对人脑负担偏高,且 bootstrap 与 hint header 术语分裂
**现状**:bootstrap:89 讲 `semantic_scope` 三层(team / project:<id> / personal KP-*);hint header `knowledge-hint-broad.cjs:843` 注释叫它"KT-MOD-0001 三轴";同时还有第二根轴 `relevance_scope` = broad/narrow(broad.cjs:798/931)。再叠加 store 物理隔离(team store vs personal store)。用户面对的是 **semantic_scope(3 值)× relevance_scope(2 值)× store(N 个物理库)** 三维。

**问题**:
- 交互角度:`semantic_scope: team` 与 `store: team` 名字撞车但语义不同(一个是知识可见范围,一个是物理存储位置);`relevance_scope: broad` 又是第三个维度。三个正交概念两个共用 "team/broad" 词汇,用户极易混淆"为什么这条 project 知识没浮现"(答:要么 store 没绑、要么 semantic_scope 不匹配、要么 relevance_scope=narrow 只在 edit 时浮现)。三条独立失败路径,无统一诊断出口。
- 策略角度:三轴本身设计正确(可见性/相关性/物理隔离确实是三个问题),但**对零用户阶段的认知预算过重**。maestro-flow 对比:它只有 scope(project/global/team/personal)一根轴 + credibility 排序,没有 relevance broad/narrow 的二次切分,心智负担明显更低。

**方案(激进可选)**:
- 短期(透明度):bootstrap 加一张"为什么这条知识(没)浮现"的三因决策表,把三轴失败路径显式化;`fabric doctor` 加一条 `why-not-surfaced <id>` 诊断,回答单条知识的可见性。
- 长期(简化):评估能否把 `relevance_scope: broad/narrow` 从**用户可见模型**降为**纯内部投递时机**(broad=SessionStart 投、narrow=PreToolUse 投),不让用户/AI 在归档时还要决定一条知识是 broad 还是 narrow——这个决定本就难,且 schema 已有 BM25 相关度可自动判定 narrow 与否。砍掉一根用户可见轴。
**价值÷成本**:诊断出口价值高成本低(P1);砍 relevance 轴价值高成本高(需评估归档/注入链路,P2 探索)。

### S7 · cite 记账:C1 已大幅减负,但"自动记账"逻辑对用户完全黑箱
**现状**:C1 已删首行八股(确认 bootstrap:106-111 只剩 recall-first 自动记账),负担确实降了。但 cite-coverage 怎么算(`knowledge_context_planned ⋈ edit_intent_checked` join,cite-policy-evict.cjs:18-20)、path overlap 怎么判(:266 相等/后缀/祖先)、什么算"命中"——全在 hook 注释里,bootstrap 只说"系统按路径重叠自动记账"。

**问题**:透明度——用户看 `fabric doctor --cite-coverage` 出一个百分比,但不知道为什么某条 edit 没被算进覆盖率(可能 recall 窗口 30min 过了、可能路径没 overlap、可能在 .workflow 豁免里)。覆盖率是个"不阻断只记录"的数字,但当它低时用户无法 self-serve 诊断。这不是 C1 没做好,是**记账可观测性**这层从来没建。

**方案**:`--cite-coverage` 输出**逐条 miss 原因**(no-recall / window-expired / path-mismatch / exempt),而非只给汇总百分比。让黑箱自解释。
**价值÷成本**:价值中(覆盖率从"神秘数字"变可行动),成本中。**P2**。

---

## 透明度专项:最不透明的 3 条规则 + 自解释方案

1. **archive_backlog "死 session" 全套判定**(fabric-hint.cjs:597-644)——session_ended 或 idle≥24h、死 session 数≥2、anti-loop 12h、还要过 high-value gate(7 关键词 + 3 event)。用户只会看到"建议归档",**完全不知道**是哪个 backlog session、为什么现在弹。**自解释**:nudge 文案带上"来自 N 个已结束会话的未归档工作(最近:<session 简述>)",并在 `fabric doctor` 暴露 backlog 明细。

2. **scope 三轴为何(不)浮现**(bootstrap:89 + broad.cjs:798/931)——semantic_scope × relevance_scope × store 三维 + 名称撞车,三条独立失败路径无诊断。**自解释**:`fabric doctor why-not-surfaced <id>`(见 S6),逐因回答。

3. **self-archive normative 词典双轨**(bootstrap:101 五词 vs hook:233 七词)——AI 自触发模型和系统观测模型用不同词典,用户说"from now on"行为不可预测。**自解释**:单一 shared 词典 + bootstrap 渲染同源 + parity 测试(见 S5)。

---

## 旋钮瘦身专项 · 推荐最小旋钮集

**删(inert/死字段)**:`reverse_unarchive_enabled`、`reverse_unarchive_dry_run`、`cite_evict_interval`、`hint_broad_budget_chars`、`hint_broad_top_k`、`hint_broad_cooldown_hours`、`hint_narrow_cooldown_hours`。
**写死成 const(需要再 externalize)**:全部 `import_*`(5)、`archive_max_*`(2)、`archive_digest_max_sessions`、`review_topic_result_cap`、`review_stale_pending_days`、`hint_summary_max_len`、`hint_reminder_to_context`、`hint_narrow_top_k`、`hint_narrow_dedup_window_turns`、`broad_index_backstop`、`conflict_lint_similarity_threshold`、`cite_recall_window_minutes`、`selection_token_ttl_ms`、`plan_context_top_k`、`recall_relevance_ratio`、`fabric_event_retention_days`、`orphan_demote_*`(3)、`embed_weight`、`embed_model`。
**合并入 nudge_mode**:`archive_hint_cooldown_hours`、`maintenance_hint_cooldown_days`、`hint_dismiss_signals`、`archive_hint_hours`(已被 backlog 取代)、`underseed_node_threshold`(归到一个 import 开关)、`cite_recall_nudge`(归 cite_policy_enabled)。

**保留的最小集(~12,身份/路由除外)**:
`default_layer_filter` · `nudge_mode` · `audit_mode` · `embed_enabled` · `archive_edit_threshold` · `review_hint_pending_count` · `review_hint_pending_age_days` · `maintenance_hint_days` · `cite_policy_enabled` · `self_archive_policy_enabled` · `cite_nudge_ignore_globs` · `onboard_slots_opted_out`(状态)。

净效果:schema ~50 → ~24(含身份/路由/管道),纯策略旋钮 38 → ~9,panel 14 → ~10(基本不变,因为 panel 本就只暴露该暴露的),**shipped config 45 key → ~18**。

---

## 本类 Top 5 高价值改动

1. **【P0】修 bootstrap 语言字段 drift**(S1)——bootstrap:93/161 指向已删除的 `fabric_language` per-project 字段,直接误导 AI。2 行改动,价值÷成本最高。

2. **【P0】旋钮瘦身:38→~9 纯策略旋钮,shipped config 45→~18 key**(S2)——删 inert/死字段 + 把 skill 内部分页阈值写回 const。lenient parser 已保证零迁移成本。这是"策略透明度"的最大单点杠杆:用户打开 config 能看懂每一行。

3. **【P1】nudge_mode 归位为唯一人类输出量闸,写进 shipped config + 删冷却类旋钮**(S3)——终结"总表盘 + 全部被替代旋钮并存"的双轨,让最重要的 UX 旋钮从隐形变默认可见。

4. **【P1】self-archive normative 词典单源化 + parity 测试**(S5)——消除 AI 自触发(5 词)与系统观测(7 词)的双轨,根治"用户说某些词行为不可预测"。已有 CJS twin 基础设施,成本低。

5. **【P1】scope 三轴自解释:`fabric doctor why-not-surfaced <id>` + bootstrap 三因决策表**(S6/透明度专项)——三轴(semantic_scope × relevance_scope × store)名称撞车、三条独立失败路径无诊断出口,是用户"为什么这条知识没浮现"困惑的根因。给单条知识可见性一个 self-serve 答案。

> 横向参照结论:maestro-flow 把注入预算(50/35/25%)、credibility 半衰期全部硬编码,只暴露 ~8 个语义性配置,且只有一根 scope 轴——证明 Fabric 当前的"极致可配置 + 三轴可见模型"是可以大幅收敛的,收敛方向有 production 先例背书。
