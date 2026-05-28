# UX-17 surface→task 覆盖映射表 + 收尾 self-audit (G-COVERAGE)

目标: 每个 user-facing 模块映射到 ≥1 UX task, 否则标 GAP。收尾 self-audit 抓漏。

## 1. Skills (3)
| 模块 | 映射 task | 覆盖面 |
|---|---|---|
| fabric-archive | UX-5(trigger F1) UX-6(recall) | trigger + recall + viability gate |
| fabric-review | UX-5(trigger) UX-15(全 action 交互) | trigger + approve/reject/modify/defer/search 实跑 |
| fabric-import | UX-5(trigger) UX-15(3-phase+dedup) | trigger + resumability + dedup |

## 2. Hooks (4 event mount points)
| 模块 | 映射 task | 覆盖面 |
|---|---|---|
| SessionStart broad (knowledge-hint-broad) | UX-7(surface→行为) | 9 clean 条 surface 验证 |
| PreToolUse narrow (knowledge-hint-narrow) | UX-7 + NEW-3(edit_intent_checked 缺) | surface + instrumentation gap |
| Stop (fabric-hint, 4-signal nudge) | UX-9(频率) | precedence + cooldown + dismiss |
| UserPromptSubmit/SessionStart (cite-policy-evict) | UX-8(cite) UX-11(parity 挂载点) | cite enforce + per-client 挂载 |

## 3. MCP tools (6)
| 模块 | 映射 task | 覆盖面 |
|---|---|---|
| fab_plan_context | UX-1/2/3/4/18 | payload fold + 协议 |
| fab_get_knowledge_sections | UX-13 | step-2 payload audit |
| fab_recall | UX-4/18 | 单步默认 + 同步瘦身 |
| fab_extract_knowledge | UX-6(archive)/UX-15(import) | 经 skill 实跑 |
| fab_review | UX-15 | 全 action 实跑 |
| fab_archive_scan | UX-6 | archive Phase1 ledger scan (调用实证) |

## 4. CLI commands (8)
| 模块 | 映射 task | 覆盖面 |
|---|---|---|
| install | UX-10/16/11/12 | fresh install + 4 客户端 + parity + 升级 |
| doctor (+~53 checks +次要 mode) | UX-14/12/11 | 自救 6/6 + 绿灯 + 次要 mode 可读 |
| init / onboard-coverage | UX-10 | onboarding (pending) |
| uninstall | UX-16 | 退出/撤销 (pending) |
| config | UX-12(G4) | 可读性 |
| plan-context-hint | UX-1/7 | shape + hook 消费 |
| serve (MCP daemon) | UX-11/12 间接 (托管 MCP tools) + NEW: serve lifecycle 未直测 | ⚠️ 见 self-audit S1 |
| metrics / onboard-coverage 输出 | UX-12(G4) | 可读性 |

## 5. Policy (4)
| 模块 | 映射 task | 覆盖面 |
|---|---|---|
| cite policy (2-state) | UX-8(BLOCKED)/UX-18 | enforce + 协议 |
| self-archive policy (2 大类) | UX-5/6 | trigger + recall |
| nudge policy (4-signal) | UX-9 | 频率 |
| AGENTS.md 两步→单步协议 | UX-18 | 工效 + fab_recall 默认 |

## 6. Doctor check 域 (~53) | UX-14(6 broken state 自救) + UX-12(绿灯) | 关键域覆盖

## 7. 跨端 GUI | UX-19 (manual, 用户手动) | Desktop Code tab + Codex Desktop

---

## 收尾 self-audit: 还有什么没测?

- **S1 — `fabric serve` daemon lifecycle (start/stop/restart/stale-lock 并发)**: 只间接经 MCP tools 覆盖, serve 命令本身的启停/并发未直测。**判定: 非 GAP** — serve 是 Tier B 基建 (out_of_scope 深测); stale .serve.lock 自救已在 UX-14 S6 覆盖; MCP tools 全测。低 UX surface。
- **S2 — cite-coverage 真实涌现数值**: UX-8 BLOCKED (NEW-3 instrumentation + soak 依赖)。**非覆盖 GAP, 是测量 BLOCKED** — 已诚实标记上报, 非"漏测"。
- **S3 — Desktop/Cursor GUI runtime**: UX-19 manual, 交用户。**非 GAP** — CLI 装对传递性覆盖配置层, GUI runtime 跑不进 CI (设计决策)。
- **S4 — 次要 doctor mode 深度 (--enrich-descriptions/--archive-history/--history/--fix-knowledge)**: UX-14 G2 验"可读可用"(浅), 未深跑各 mode 全路径。**非 ship-GAP** — 主 doctor + --fix 已深测; 次要 mode 浅覆盖可接受。
- **S5 — events.jsonl rotation 实际触发**: 已知 [[project-events-jsonl-bloat-rc36]], size-gate 检测已验 (UX-14 S3); 实际 rotation 写盘未端到端跑。**非 ship-GAP** — 检测+方案已锁, dev-repo 累积非产品缺陷。

## 覆盖结论
**0 个 user-facing 模块 GAP (0 task)**。每个模块均映射 ≥1 task。5 个 self-audit 项均判定为「非覆盖漏洞」(out-of-scope 基建 / BLOCKED-非漏测 / manual-交用户 / 浅覆盖可接受)。

NEW-N 累计 5 (NEW-1~5; NEW-3 P1 其余 P3), 远低于 ≈29 告警线。

## 8. 横切 / Transversal UX 面 (gemini 交叉 audit 补, 已逐条核实)
| 横切面 | 覆盖状态 | 判定 |
|---|---|---|
| --help / 命令发现 | UX-10 done_when 含 'fabric --help/各命令 --help 首屏' | 已映射 UX-10 (pending 执行), 非 GAP |
| Error/fallback UX (MCP 断连/skill timeout/malformed config) | PARTIAL: UX-13 G3(MCP 传错参报错) + UX-14(doctor 错误 remediation 6/6) | 离散模块已覆盖; 广义 runtime-failure UX 系统性未测 → **NEW-6 P2** |
| i18n 本地化渲染 (zh/en/hybrid/match-existing) | IMPLICIT: 所有 install/doctor dogfood 见 en+zh 正确渲染, 无专测 task | 隐式已验, 无 dedicated task → NEW-6 含 (P3) |
| Update/upgrade 通知 | 核实: **无版本通知 feature** (grep 无); upgrade 执行=UX-16 | N/A + UX-16, 非 GAP |
| Privacy/telemetry consent | 核实: **Fabric local-first 无外部 telemetry/网络调用** (grep 无 fetch/posthog/sentry; events.jsonl 全本地) | **N/A** (无外部数据采集即无需 consent) |

## 覆盖结论 (修订)
**0 个离散 user-facing 模块 GAP**。所有 Skill/Hook/MCP/CLI/Policy/Doctor 离散模块映射 ≥1 task。
横切面经 gemini ≥2 LLM 交叉补全: --help(UX-10)/upgrade(UX-16) 已映射, privacy/version-notif 核实 N/A, error-UX + i18n 系统性深测 → NEW-6 P2 (partial 覆盖已在, 非已知缺陷, 非 blocking)。
→ G-COVERAGE 达标: 0 漏模块 + 横切面已显式登记 + 深度 gap 立 NEW-6。
NEW-N 累计 6 (NEW-3 P1 / NEW-6 P2 / 其余 P3), 远低于 ≈29。
