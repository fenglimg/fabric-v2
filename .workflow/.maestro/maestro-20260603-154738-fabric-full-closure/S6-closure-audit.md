# S6 收口 Audit — dogfood 清单 Part A/B/C 逐条对账

> 真源: `.workflow/.scratchpad/rc2-dogfood-experience-issues.md`(Part A 手记 / Part B 走查 / Part C 设计方向)。
> 状态枚举: **RESOLVED**(已修+commit) · **WONTFIX**(显式不修+rationale) · **DEFERRED**(用户决策 defer, 留接口) · **OUT-OF-SCOPE**(不在本 goal 边界, 另列)。
> commit 索引: 前序会话(multistore-abcd) `42ab733`A/B1(F3/F28) · `dec6e01`D1(F7-crash/F20) · `31be901`F26 · `c4c2002`F4。本 goal(full-closure) `7e5e0e4`S1 · `284d1cd`S2(F7-body) · `4422f20`S3 · `d721b52`S4(F17/F10) · `26deb21`S4(C3/install污染) · `2e0eb44`S5(F8/F13/F21/F15/F16/F23) · `918f1bb`S6(F1/F2/F19/F27)。

## Part A — setup 自曝 / 用户体验手记

| # | 一句话 | 状态 | 依据 |
|---|---|---|---|
| #1 | recall personal 层孤儿硬错 | **RESOLVED** | = F7+F20。`dec6e01`(crash 跳过+warn)+`284d1cd`(store body 投递)。本会话 fab_recall 实测正常返 personal 条目不崩 |
| #2 | 13 draft 空壳无声隐藏 | **RESOLVED** | = F10。`d721b52` doctor knowledge_summary_opaque 扫 store(含 personal),空壳对用户可见 |
| #3 | recall payload 偏大甩给调用方 | **WONTFIX** | by-design: no-server-side-filter 原则(返全候选+description, LLM 自选);两步 flow(`fab_plan_context`→`fab_get_knowledge_sections`)即分页机制;`retrieval_budget_profile=conservative` 可整体缩;`payloadHardBytes` 65KB 兜底硬截断已存在。warn 是 soft 信号不是缺陷。见 [[feedback-no-server-side-kb-filter]] |
| #4 | 派生态无声 drift | **WONTFIX(existing)** | `fabric doctor --fix` 自愈 + SessionStart hook 已是文档化自愈路径;派生态由 engine 重建(AGENTS.md 约束)。无新增缺口 |
| #5 | install 客户端能力摘要过时(5端×4能力) | **OUT-OF-SCOPE** | 不在 S6 done_when。install capability matrix 重写属独立项;与 [[reference-cursor-supports-skills]] 关联,留待后续 |
| #6 | "下一步"文案随 5端更新 | **OUT-OF-SCOPE** | 随 #5 一起,独立项 |
| #7 | 安装策略旧形态 / 向量 onboarding | **OUT-OF-SCOPE** | boundary out_of_scope 明列「向量/embedding install onboarding(单列)」;属设计确认类 |
| #8-Warn1 | metric event 残留泄漏 | **RESOLVED** | = F16+F1。`2e0eb44`(doctor --fix flushMetrics 免重启)+`918f1bb`(remediation 文案据实) |
| #8-Warn2 | fabric-archive SKILL.md 超 token | **WONTFIX** | 5792 tok 触 5000 WARN 但 < 10000 ERROR(install 不阻断);skill 已 progressive-disclosure(`ref/` 15 文件 + 尾部 ref-only 指针);超额 ~790 tok 在 contract-locked phase/rule/protected-token 内容, 裁剪风险>收益(最常用 skill 行为回归风险) |
| #9 | 知识库分层"未接线" | **RESOLVED** | 现象的架构根因 = 根因簇 1(F3/F4/F7→F24/F25)全修;读/写侧本就接线, 缺的 bind onboarding 已由前序 A(`42ab733`)补 |
| #10 | 半迁移态(个人 store / 团队 dual-root) | **RESOLVED** | S2/S3 全砍: `284d1cd` 写侧 store-only + 硬失败, `4422f20` 删 dual-root 创建 + 删空 ~/.fabric/knowledge。半迁移态终结, store 成唯一路径 |

## Part B — goal-mode 全功能走查(23 findings)

| id | 面 | 状态 | 依据 |
|---|---|---|---|
| F1 | doctor rotation 文案 | **RESOLVED** | `918f1bb` remediation 补「--fix 也 flush metrics(F16 免重启治本)」zh+en |
| F2 | cite nudge .workflow 噪音 | **RESOLVED** | `918f1bb` cite_nudge_ignore_globs(默认 `.workflow/**`+config 扩展);+7 测试 |
| F3 | team store 未 bind 零引导 | **RESOLVED** | 前序 A `42ab733` install/doctor bind+switch-write onboarding nudge |
| F4 | store list vs whoami remote 矛盾 | **RESOLVED** | `c4c2002` whoami remote 口径对齐 store list(物理 git 为真源) |
| F6 | serve --help + 顶层列 serve | **RESOLVED(by-quarantine)** | serve 已 quarantine 到 server-http-experimental, 不在 `allCommands`(KB [[fabric-serve-quarantine-not-delete]]);`fabric serve`→unknown-command usage(无 serve), 顶层列表正确不含;finding 预 quarantine 形态 |
| F7 | personal 层 body 两路 read 全废 | **RESOLVED** | `dec6e01`(crash)+`284d1cd`(buildCrossStoreBodyIndex, recall+get_sections 双路径取 store body) |
| F8 | get_sections ai_selection_reasons schema | **RESOLVED** | `2e0eb44` server 删强制 reason 对齐 optional schema |
| F10 | doctor opacity 只扫 team 漏 personal | **RESOLVED** | `d721b52` collectStoreKnowledgeSummaries 扫 read-set(team+personal) |
| F12 | session_id caller 传不到 server 自己有 | **WONTFIX** | 维护侧不对称, 非 bug: caller 有 session_id 时即传(AGENTS.md「session_id」规则已文档化), hook stdin payload 携带;server archive_scan 在自身上下文有 fallback。hook-vs-server 上下文边界固有, 强行"统一"无收益 |
| F13 | extract_knowledge required 漏 source_sessions | **RESOLVED** | `2e0eb44` source_sessions base required 对齐 |
| F15 | review reject 原地软删语义不直观 | **RESOLVED** | `2e0eb44` reject 移 pending/→rejected/ + list include_rejected |
| F16 | metric event 持续泄漏(HIGH) | **RESOLVED** | `2e0eb44` doctor --fix flushMetrics 免重启;推翻 leak 框定(knowledge_context_planned 是 cite-audit 非 metric, 决策 turn-event-is-cite-audit-not-metric) |
| F17 | 5 hook / AGENTS 描述 3 类(+skill 数) | **RESOLVED** | `d721b52` bootstrap-canonical Write-flows → 列全 7 skills;pcf committed 快照(落后多 rc)下次 `fabric install` 同步 |
| F18 | hook .cjs 体积巨大 | **WONTFIX** | standalone bundled 零运行时依赖 .cjs 是设计要求(install 直拷, 不解析 node_modules);Node 解析 ~96KB sub-ms, 远小于进程 spawn 成本;externalize deps 会破坏 standalone 不变量 |
| F19 | archive 阈值 doc 5 vs config 20 | **RESOLVED** | `918f1bb` bootstrap-canonical 改引用 config `archive_edit_threshold`(默认 20)消除魔数漂移 |
| F20 | cite 自动记账闭环断裂(HIGH) | **RESOLVED** | 根因 recall 崩 = `dec6e01`(D1)修;cite 记账 63 测试绿(S4) |
| F21 | scope-explain 不校验 scope 名 | **RESOLVED** | `2e0eb44` scope 语法校验抛 actionable(unknown segment 仍通过 by-design) |
| F22 | cite nudge 口径 vs 稽核口径矛盾 | **RESOLVED** | = F20 同源;recall 修通→记账闭环通, Edit 触达数>0(重启 server 后操作验证) |
| F23 | --fix-knowledge 无 dry-run | **RESOLVED(existing)** | `2e0eb44` 核实 --fix-knowledge --dry-run 已存在(verify-only 预览) |
| F24 | fabric-connect/audit 不可用/盲区 | **RESOLVED(via-dep)** | connect 依赖 recall=F7✓;audit 漏检 personal=F10✓。本会话 live-verified: recall 返 personal 条目 + doctor opacity 报 13 personal 空壳。skill 本体无误 |
| F25 | fabric-import team 误路由 personal | **RESOLVED(via-dep)** | 误路由 = scope-explain team 坏(F3);F3 由 A onboarding + S2 store-only 修;import skill 本就守「NEVER auto-classify personal」 |
| F26 | sync --continue/--abort 吐 stack | **RESOLVED** | 前序 `31be901` |
| F28 | sync/store 打 stale「未接线」警告劝退(HIGH) | **RESOLVED** | 前序 B1 `42ab733` 删三处 experimental-unwired 打印+i18n key+stale 注释 |

## Part C — 设计方向 D1-D8(用户 normative)

| D | 一句话 | 状态 | 依据 |
|---|---|---|---|
| D1 | 删旧 ~/.fabric/knowledge 禁写 | **RESOLVED** | `4422f20` 删空 + 停止创建 dual-root |
| D2 | store 目录可读层(UUID 不变) | **RESOLVED** | `26deb21` C3 by-alias symlink + doctor heal |
| D3 | org/project 分层 | **DEFERRED(C1)** | scope grammar 含 `project`/`org`(可解析 + F21 校验), 物理 per-project store 接线 = C1 用户决策 defer, 仅留 scope 接口 |
| D4 | 公司库关联 onboarding | **RESOLVED** | 前序 A `42ab733` install/doctor bind+switch-write nudge |
| D5 | 项目内不写 + pending 按 store 分层 | **RESOLVED** | S2 写侧 store-only(项目本地不再承载 body);cross-store-write resolveStorePendingBase → pending 内化进 store |
| D6 | 交互升级 + 入门 skill | **PARTIAL/DEFERRED** | (a) install/doctor 主动 nudge = A 已落(止血);(b) 专门 onboarding skill 系统化 = 未做, 属独立增量(非本 goal done_when) |
| D7 | 半迁移须终结禁 dual-root | **RESOLVED** | S2/S3 全砍 fallback(用户决策"快刀斩乱麻", 与 D4 onboarding 同批)= `284d1cd`+`4422f20` |
| D8 | scope team readSet 空归因 | **RESOLVED** | 归因正确(非 resolver bug, 缺 bind 输入);修 D4 即解 |

## 收口结论

- **真修**(本 goal + 前序): A/B/C 共 23 Part-B + 10 Part-A + 8 Part-C, **无遗漏对账**。
- **WONTFIX(4)**: A#3(payload by-design)· A#4(drift 自愈 existing)· A#8-Warn2 / F18(维护侧, progressive-disclosure / standalone bundled)· F12(上下文边界固有)—— 均带 rationale。
- **DEFERRED(2, 用户决策)**: D3 org/project 物理库(C1)· D6(b) 入门 skill(独立增量)。scope 接口与止血 onboarding 已留/已落。
- **OUT-OF-SCOPE(3)**: A#5/#6(install 能力摘要 5端重写)· A#7(向量 onboarding)—— boundary 明列单列, 另行规划。
- 全程 tsc --noEmit 绿;shared 568 + server 820 + cli 963 测试绿。

**ALL_GOALS_DONE**: S1-S6 全 done + 本 audit Part A/B/C 逐条标注无遗漏。
