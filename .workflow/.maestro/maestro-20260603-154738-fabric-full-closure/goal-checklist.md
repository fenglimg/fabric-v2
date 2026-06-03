# Fabric 体验优化 — 一程全收尾 goal-checklist

> **status.json 是真源,本文件是投影。** exec=internal(主线串行, 不让 Agent 编排替代实际工作)。
> Resume: 读本文件取「执行准则/边界/子目标」作行动手册, 然后调 `/maestro-ralph continue` 推进下一步。
> 全砍分阶段 spec: `../maestro-20260603-145942-fabric-multistore-abcd/B2-dualroot-cutover-spec.md`
> 问题真源(逐条对账): `.workflow/.scratchpad/rc2-dogfood-experience-issues.md`(Part A/B/C)
> 承接: 上会话已交付 A/B1/D1/F26/F4 共 5 commit(分支 feat/multistore-abcd)。**本 goal 跑完 = 全部体验优化收尾。**

## 终态
知识只住在 store 里(无 dual-root、无假告示);分层 onboarding 完整;dogfood 清单 Part A/B/C 每条 resolved 或 wontfix(带 rationale), 无遗漏。

## ⚠️ 数据风险(首要纪律)
pcf 自身 22 条 committed 项目本地知识 + 20 测试断言 dual-root。**S1 迁移工具必须先于 S2 翻写。**

## 执行准则
1. 严格 S1→S2→S3(全砍迁移链, 安全网先行);S4/S5/S6 全砍后推进, 各自 commit
2. 每条 finding 先对 dogfood 清单 + grep 现状, 确认未被前 5 commit 覆盖再做(防 reimplement noop)
3. 主线串行 Edit/Bash 优先, 不 spawn Agent 替代实际工作
4. 每簇 typecheck + 相关 test 绿才 commit + sha 回填;破坏性操作必须 dry-run
5. 低值/维护者侧项允许 fix OR document-wontfix+rationale, 不强行改;fix 不 hide

## 子目标(done_when 见 status.json)
- [x] **S1 全砍-地基**: install 保证 store + `store migrate`(dry-run)+ 迁移 pcf 22 条 recall 仍命中
- [x] **S2 全砍-翻写**: 写侧 store-only + 无 store 硬失败 + **F7 store-body 完整投递**
- [x] **S3 全砍-收尾**: 重写 ~20 测试 + 删空 `~/.fabric/knowledge`
- [x] **S4 核心打磨**: C3 可读层 · cite 闭环(F20/F22)· F10 doctor 扫 personal · F17/AGENTS.md 文案 · 测试污染
- [x] **S5 真 bug 清扫**: **F16 metric leak(HIGH)** · F8 · F13 · F21 · F23 · F15
- [x] **S6 琐碎+边角+收口**: F1·F6·F19·F27·F2·F12·F18·F24·F25 + Part A #3/#8-Warn2;**收口 audit: 清单每条标 resolved/wontfix**

## 已定决策(无需再问)
C1 = defer(留 scope 接口) · C3 = UUID 不变 + by-alias 可读层 · 已做: F3/F4/F26/F28/D1(F7-crash)/F20-partial

## 轮次日志
- **2026-06-03 S6 + 收口**(承接 S1-S5 已交付): S6 真修簇 `918f1bb` 落地 F1(doctor remediation 文案据实)/F2(cite_nudge_ignore_globs `.workflow/**`)/F19(archive cadence 引用 config 消魔数)/F27(whoami/status `--json` + warnUnknownFlags)。F6=resolved-by-quarantine, F24/F25=resolved-via-dep(F7/F10/F3 live-verified), F12/F18/A#3/#8-Warn2=WONTFIX+rationale。收口 audit `S6-closure-audit.md`: Part A(10)+B(23)+C(8)逐条对账无遗漏; out-of-scope=A#5/#6/#7(install 能力摘要/向量 onboarding 单列), deferred=D3/D6b(C1)。tsc 全绿; shared 568 + server 820 + cli 963 测试绿。

## 收口对账
完整逐条 resolved/wontfix/deferred/out-of-scope 见同目录 `S6-closure-audit.md`。

<!-- ALL_GOALS_DONE 哨兵:S1-S6 全 done + 收口 audit 清单无遗漏后由 post-goal-audit 写入 -->
ALL_GOALS_DONE
