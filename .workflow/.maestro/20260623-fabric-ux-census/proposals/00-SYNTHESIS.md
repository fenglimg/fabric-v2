# Fabric 全触点 UX/DX 审计 — 综合报告

> 范围:5 类用户侧触点(CLI / Hook / MCP / Skill / Strategy)等深度 + 架构侧。双角度(交互体验 + 策略)。
> 基线:C1(20260622 收敛方案)视为**已落地基线**,本轮审计 C1 之后的当前状态找**新**问题。
> 授权:用户明确「允许任何增删改 / clean-slate」,零用户无兼容包袱。本轮交付 = 诊断 + 方案 + 代码参考。
> 详报:`01-cli.md` `02-hook.md` `03-mcp.md` `04-skill.md` `05-strategy.md` `06-architecture.md`

---

## 0. 总览(6 维 × 最严重发现)

| 维度 | 最严重发现 | 严重度 |
|---|---|---|
| CLI | `grouped-help` 手维护白名单漏接 `context` 命令(新命令默认从 `--help` 消失);`doctor` 一命令做 8 件事、`--cite-coverage` 喷 20+ 行指标墙 | 🔴🟠 |
| Hook | **narrow hook 教 AI 调退役工具 `fab_plan_context`**(P0);`fabric-hint` 5 信号里 4 个仍硬 `decision:block` 违反 KT-DEC-0007;SessionStart ALWAYS-ACTIVE summary 不截断灌爆开局 | 🔴🔴🟠 |
| MCP | `fab_extract_knowledge` 名说"读"实则"写";`fab_review` flat-shape 让 LLM 推不出 required 参数必首调失败;`fab_recall` 双数组逼 agent 每次 join | 🟠🟠 |
| Skill | `review`↔`audit` 语义重叠是最大歧义源;router `fabric` 抢 leaf 触发词却不消歧(空壳);8 skill 触发词 ~45 个 | 🟠🟠 |
| Strategy | **bootstrap 教设 `fabric_language`,schema 已删该字段**(P0);config ~45 key「旋钮汤」含死字段;`nudge_mode`(最该可见的表盘)反而隐形 | 🔴🟠 |
| 架构 | 每个 hook/skill **5 份镜像入 git**,集合已漂移(16/17/17/17/18 文件数无一相同);hook 是与 TS 平行的第二套 cjs 运行时;`events.jsonl` 双语言写入不过 schema | 🟠🟠 |

---

## 1. P0 必修 — C1 半落地遗留的「主动误导 AI」(已 grep 验证,可立即修)

C1 改造分波次落地,留下两处 **byte-locked / 硬编码** 的过期指针,此刻每个会话都在误导 AI:

### P0-1 · narrow hook 指向退役工具
- **现状**:`.claude/hooks/knowledge-hint-narrow.cjs:1245`
  ```js
  lines.push("  (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)");
  ```
  `packages/server/src/index.test.ts:72` 断言 `FABRIC_SERVER_INSTRUCTIONS).not.toContain("fab_plan_context")` —— 该 MCP 工具 W1-2 已退役。
- **问题**:每次编辑触发 narrow 提示,都告诉 AI 去调一个**不存在的工具** → AI 调用必失败/困惑。
- **方案**:删该尾行,或改为当前真实入口(`fab_recall` / 直接 Read 正文路径)。**注意:同字符串在 5 份镜像里都要改**(见 §2-T2)→ 应改真源后 `fabric install` 同步,而非手改 5 处。
- **价值 High ÷ 成本 Low**(1 行 + 同步)。

### P0-2 · bootstrap 教设已删除的语言字段
- **现状**:`packages/shared/src/templates/bootstrap-canonical.ts:93 / :161`
  > Language:渲染按 `.fabric/fabric-config.json` 的 `fabric_language` 字段。
  但 `packages/shared/src/schemas/fabric-config.ts:150-152`:`fabric_language` 已不再是 per-project 字段,语言搬到 `~/.fabric/fabric-global.json#language`,**root parser 宽松 → 旧 key 被静默吞掉**(用户设了不报错也不生效)。
- **问题**:byte-locked 契约把过期事实固化进**每个 install 的 AGENTS.md**;用户/AI 照做却无效、零反馈。
- **方案**:改 §93/§161 指向 `~/.fabric/fabric-global.json#language`(或 `fabric config language`);跑 bootstrap-canonical/parity 测试 + 重装同步。
- **价值 High ÷ 成本 Low**(2 行 + 重建)。

> 这两条印证一个**系统性风险**:C1 这种「分波次改契约」的改造,缺一个「stale-pointer 扫描闸」——退役一个工具/字段时,没机制扫出所有还在指向它的 hook 文案 / bootstrap 文案。**建议把『退役物全仓引用扫描』做成 doctor 的一个 lint**(根治而非逐个打地鼠)。

---

## 2. 五个跨维度根因主题(把分散发现归纳到根上)

### T1 · 契约改造缺「过期指针扫描」→ 散落 stale pointer
P0-1 / P0-2 是症状。根因:Fabric 自己是知识层,却没有「改了 X、谁还引用 X」的反查。**根治** = doctor 加 retired-reference lint(扫 hooks 文案 + bootstrap + skill 对 MCP 工具名/config 字段的引用,比对当前真实集合)。价值 High ÷ 成本 Med。

### T2 · 镜像漂移 / dogfood 产物入库(架构最大税)
- **实证**(`06-architecture.md`):每个 hook/skill 有 **5 份**:真源 `packages/cli/templates/` + 4 套 dogfood 自装产物(`.claude/` `.codex/` `packages/cli/.claude/` `packages/cli/.codex/`)。当前 md5 因刚 `b6c3066` install-sync 过而一致,**但集合已漂移**:`archive-hint.cjs` 仅 1/5、`summary-fallback.cjs` 仅 2/5、`cite-contract-reminder.cjs` 4/5 且独缺真源;5 目录文件数 16/17/17/17/18 无一相同。
- **后果**:改一处文案 → 5x diff;P0-1 这种修必须改 5 份才不漂;doctor 背一批 `*Drift` 补偿 lint。
- **方案(架构 Top1)**:4 套 dogfood 自装镜像是 `fabric install` 可重生的派生物 → **`.gitignore` 掉,5→1 真源**。极低成本根治集合漂移 + 连带删掉一批 drift lint。价值 High ÷ 成本 Med。

### T3 · 过度可配置(knob soup)
- `.fabric/fabric-config.json` shipped 45 key,schema ~50;纯策略阈值约 38 个,UI panel 只暴露 14。含**死字段**(`cite_evict_interval`、`reverse_unarchive_*`)和已 RETIRED 仍 materialize 的 `hint_broad_budget_chars`。`nudge_mode`(本应是「替代旋钮汤」的总表盘)在 shipped config 里**根本没写**,反而被替代的分页旋钮全显形。
- **横向**:maestro-flow 把预算/半衰期**硬编码**、只暴露 ~8 语义旋钮、单根 scope 轴 —— production 先例。
- **方案**:删死字段;把纯内部阈值写死/收进引擎;暴露最小语义旋钮集(~8);`nudge_mode` 提为唯一可见表盘。价值 High ÷ 成本 Med。

### T4 · 命名/契约对「消费者」撒谎(消费者 = AI 或人)
跨 MCP/CLI/Skill 同一病:对外暴露的名字/形状与真实行为不符,逼消费者试错。
- MCP:`fab_extract_knowledge` 名="抽取/读"、实=Persist 写盘(`03-mcp.md`);`fab_review` flat-shape 把 per-action required 全标 optional,LLM 推不出 reject 必须给 reason → 必首调失败;`fab_recall` candidates[]/paths[] 拆两数组靠 stable_id join。
- CLI:`store add` vs `create`、`switch-write` vs `route-write` 同义词撞车;`doctor` 八合一 + 14 隐藏 flag。
- **方案**:`fab_extract_knowledge`→`fab_propose_knowledge`(名实一致);`fab_review` description 内嵌逐-action required 清单(maestro-flow `team_task` 标准补法);`fab_recall` 合并单数组免 join;store 去同义词。价值 High ÷ 成本 Low-Med(多为改名/改 description)。

### T5 · nudge 仍硬 block,违反 KT-DEC-0007(hook=提醒层,永不做 gate)
- `fabric-hint.cjs`:W5 宣称「Stop 默认安静」,但只有 `archive` 信号走 dual-sink 软提示(`:2528`),`archive_backlog`/`review`/`import`/`maintenance` 4 个仍 `out.write` 硬 `decision:block`(`:2497`/`:2538`),与 `nudge_mode` 无关、打断 Stop 流。实跑默认 config 下 backlog(28 死会话)直接 block 复现。
- **方案**:4 信号统一走软 sink + 受 `nudge_mode` 调控,彻底兑现「提醒非闸」。价值 High ÷ 成本 Med。

### T6 · Skill 拓扑膨胀(8 常驻 → 4 leaf + 1 router)
- `review`↔`audit` 重叠(audit 自己不写、经 review 落盘);router `fabric` 抢 leaf 触发词却只机械重列、不消歧(对照 maestro router 的 session+rationale 状态机是空壳);`store`/`connect`/`audit` 缺 i18n、`connect`/`audit` 缺 Precondition。
- **方案**:`audit`→`review` 的 `retire` mode;`import`→`archive` 的 source mode;`sync`→`store`。**8→4 leaf + 1 兜底 router**,触发词 ~45→~15。价值 High ÷ 成本 High(改动面大)。

---

## 3. 全局 Top 清单(跨维度,按 价值÷成本 排序)

| # | 改动 | 维度 | 价值 | 成本 | 波次 |
|---|---|---|---|---|---|
| 1 | P0-1 narrow.cjs 删退役工具尾行(改真源+同步) | Hook | High | Low | W0 |
| 2 | P0-2 bootstrap 修 `fabric_language` 指向 | Strategy | High | Low | W0 |
| 3 | `fab_extract_knowledge`→`fab_propose_knowledge`+统一 instructions | MCP | High | Low | W1 |
| 4 | `broad.cjs:959` ALWAYS-ACTIVE summary 套用 `hint_summary_max_len` 截断 | Hook | Med-High | Low | W1 |
| 5 | `fabric-hint` 4 信号 block→软 nudge(守 KT-DEC-0007) | Hook | High | Med | W1 |
| 6 | `grouped-help` 从 `allCommands` 派生+group 标签(修 `context` 浮空) | CLI | High | Med | W1 |
| 7 | `fab_review` description 内嵌逐-action required 清单 | MCP | Med | Low | W1 |
| 8 | 删 config 死字段(`cite_evict_interval`/`reverse_unarchive_*`/`hint_broad_budget_chars`) | Strategy | Med | Low | W1 |
| 9 | **4 套 dogfood 镜像 `.gitignore`,5→1 真源** | 架构 | High | Med | W2 |
| 10 | doctor 加 retired-reference lint(根治 T1) | 架构/Strategy | High | Med | W2 |
| 11 | 旋钮瘦身至最小语义集 + `nudge_mode` 提为总表盘 | Strategy | High | Med | W2 |
| 12 | `fab_recall` candidates/paths 合并单数组免 join | MCP | Med | Med | W2 |
| 13 | shared `exports.development` 走 src 免 rebuild(根治 rc.21/24/29 复发) | 架构 | Med | Med | W2 |
| 14 | doctor 八合一拆子命令 + `--cite-coverage` 指标墙默认收起 | CLI | Med | High | W3 |
| 15 | store 命令去同义词 + 分层 | CLI | Med | Med | W3 |
| 16 | **skill 8→4+1**(audit→review / import→archive / sync→store) | Skill | High | High | W3 |

---

## 4. 推荐落地波次

- **W0(立即,分钟级)**:#1 #2 —— 已验证的 P0,正在持续误导 AI,且用户已授权。先修真源再 `fabric install` 同步(顺带验证 T2 同步链)。
- **W1(本轮 cheap-high)**:#3–#8 —— 全是改名/改文案/加截断/删死字段,低成本高价值,无结构风险。
- **W2(结构根治)**:#9–#13 —— 镜像收敛 + retired-reference lint + 旋钮瘦身 + build 链根治。一次性消掉一大批「维护税」。
- **W3(大重设计,需逐项拍板)**:#14–#16 —— doctor 拆分、store 重命名、skill 拓扑收敛。改动面大、影响跨端契约,建议每项单独 grill + 单独 PR。

---

## 5. 方法论备注
- 本轮采「census 先于收窄」:每维度先枚举全集再深挖,避免被个别例子带偏。
- 所有 P0 claim 已 grep/sed 二次验证(narrow.cjs 首次 grep 未复现、sed 直读 settle —— 印证「audit 落地前必验证」)。
- C1 当基线、只找增量,避免与正在落地的 C1 波次冲突。
