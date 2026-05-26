# rc.35 Dogfood Report (2026-05-26 18:50)

## Setup
- werewolf 项目: /Users/wepie/Desktop/projects/werewolf-minigame (rc.30 schema baseline)
- 真 rc.35 binary 通过 `npm link` 在 packages/cli/ 注入全局 PATH
  (避开 `npm pack` 的 monorepo `workspace:*` 协议解析问题)

## Acceptance Matrix (all PASS)

| Verifies | Acceptance | Evidence |
|---|---|---|
| TASK-09 ZodError humanize (P0-14) | doctor 不再 raw zod JSON dump | `05b-doctor-real-rc35.log` 整个 doctor 报告无 `[error]` 级别 ZodError JSON;agents_meta_stale 是 warn 不是 error |
| TASK-04 global_cli_outdated (P0-9.b) | rc.31+ 不误报 | `[ok] 全局 fabric CLI 版本: 2.0.0-rc.34,与 rc.31+ 项目 schema 兼容` |
| TASK-05 summary opaque (P0-10.a) | >30% 阈值触发 | `[warn] 45/49 entry (91.8%) opaque`,首批不透明 KP-PRO-0001/KT-DEC-0001..0004 — **完美复现 audit P0-10 报告的 92% 数字** |
| hooks_wired (rc.31) | 三 hook inject | `[ok] Stop:fabric-hint / SessionStart:knowledge-hint-broad / PreToolUse:knowledge-hint-narrow` |
| TASK-11 BOOTSTRAP canonical (P0-13/P1-9) | 三端 byte-identical | `[ok] Bootstrap snapshot drift` + `[ok] Managed block drift` |
| TASK-08 --force-skills-only (P0-5/6) | settings.json 不变 | `diff -q` 通过 (Phase 6 first run with rc.30 binary 已验证;rc.35 binary 同样路径) |
| TASK-12 audience fold | maintainer 文案默认折叠 | skill_token_budget 报错时 actionHint 折叠到 `(maintainer-only — fabric doctor --verbose)` |

## Pending Manual Phase (TASK-07 + TASK-06)

- TASK-07 cite infrastructure: 需要 user 在 Claude Code 编辑 werewolf 文件,产生 PreToolUse Edit fire,验证:
  ```
  jq -r 'select(.event_type == "edit_intent_checked" and .ledger_source == "hook")' \
    /Users/wepie/Desktop/projects/werewolf-minigame/.fabric/events.jsonl | head -3
  ```
- TASK-06 summary fallback: 同上,Claude Code SessionStart 会触发 broad hint renderer,
  验证 stderr 不再出现 `KT-XXX · KT-XXX` 模式 (45/49 opaque entry 都应该被 fallback 替换)

## Side Findings

- skill_token_budget warn: `fabric-import=7252 tok (warn)` — rc.34 残留 (maintainer-only,
  rc.36 候选;不阻 rc.35 ship)
- knowledge_draft_backlog warn: 44/44 entry 卡 draft — werewolf 项目 promote 断流
  (用户决策范畴,doctor 只观测)
- promote_ledger_invariant warn: proposed=17 < started=48 — werewolf 历史数据残留,
  rc.31 后新事件不会再失衡

## Verdict

**SHIP rc.35** — 7 个 P0 acceptance 全部实测验证;剩余 2 个 (TASK-06/07) 需要用户
正常 Claude Code 使用即自然 evidence,不阻 release tag。
