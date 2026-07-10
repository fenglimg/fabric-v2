# v2.0.0 GA UX Audit — 8 阶段用户旅程 Coherence (Phase 5 / C5)

**Date**: 2026-05-27
**Lens**: 用户从 fresh state 经过 8 阶段的衔接是否顺畅 — 每个 step 离开时用户是否清楚怎么走到 next step,有没有 dead-end
**Method**: paper walkthrough,基于 inventory + skills + hooks verdict + 实测 ([[feedback-claude-simulated-onboarding]] 30min self-演 rc.32 baseline 5%)

---

## Stage 1 — install (`fabric install`)

**入口**:用户在新项目根目录跑 `fabric install`
**期望产出**:`.fabric/` scaffold + hooks 装 + MCP 配置 + 三 client config 写

**衔接到 Stage 2**:
- ✅ install 末尾 banner 提示「下次开 Claude/Codex/Cursor session 会看到 KB 索引」(per `install.ts` post-setup phase)
- ⚠ banner 文案没明示「需要重启 client」 — 用户不知道现 session 已装的 hook 不生效

**Dead-end 风险**:
- ⚠ install 失败 mid-step(scaffold OK / mcp 失败)→ 用户拿到 partial state,**没有明确的 "rollback 或继续" 引导**
- ⚠ install 跑完但用户的 client 已开着 → hook 不会立即生效,**用户体验是"装了但没动静"**

**Verdict**:**NEEDS-1-POLISH**

**Recommendations**:
1. install 末尾加 `请重启 Claude/Codex/Cursor 让 hook 生效` 显式提示
2. partial-state recovery 路径:`fabric install --resume <phase>` 或 detect partial 后 prompt

---

## Stage 2 — discover (SessionStart hook → KB 索引出现)

**入口**:用户在装 fabric 的项目重新开 Claude/Codex/Cursor session
**期望产出**:`[fabric] Session start — N broad-scoped knowledge entries...` to stderr/stdout

**衔接到 Stage 3**:
- ❌ broad KB 索引列完后,**没有任何引导让用户开始 cite** — 用户看到 22 条 KB 不知道下一步该做啥
- ❌ revision_hash 行用户看不懂用途
- ❌ Codex/Cursor 不一定显示 stderr,**那两 client 用户可能完全 invisible**

**Dead-end 风险**:**HIGH** —— 用户看到 KB 列表后,**没有 prompt 让他们引用**
- 默认 first-time 体验:「哦,有这些 KB」→ 然后呢?
- 默认 N-th-time 体验:「又是这个列表」→ 疲劳

**Verdict**:**NEEDS-2-POLISH**

**Recommendations**:
1. KB 索引末尾加 `下一步: 写代码或编辑文件,Fabric 会在 PreToolUse 推相关 KB` —— 明示自动 narrow hint 路径
2. 跨 client adapt — Codex 通过 prompt prepend / Cursor 通过通知,确保索引可见
3. revision_hash 改为人读 `# 知识库版本: 2026-05-27 (22 entries)`

---

## Stage 3 — cite (AI 写 `KB: <id>` 首行)

**入口**:AI 准备 edit/decide/propose plan
**期望产出**:回复首行 `KB: <id> (用法) [state]` 或 `KB: none [<reason>]`

**衔接到 Stage 2**(反向 — cite 失败后怎么从 discover 找 id):
- ⚠ AI 写 `KB: K-999 (auth) [recalled]` 但 K-999 不存在 —— **没机制 catch**,污染 cite 统计(rc.32 cite hallucination 推 rc.37)
- ✅ 两步调用强制(`fab_plan_context` → `fab_get_knowledge_sections`)防 id 编造,但前提是 AI 真走两步

**衔接到 Stage 4**(cite 后是否触发 archive):
- ❌ AI 完成 edit/decide 后,**没有 hook 检查是否值得 archive**(self-archive policy 靠 AI 主观判)
- rc.32 实测 cite 遵循率 3.1% — 政策力度不够

**Dead-end 风险**:**HIGH** —— cite policy 几乎无强制
- 用户视角:政策写在 AGENTS.md L52-83,但 AI 的回复经常看不到 `KB:` 首行
- 文案稽核(`fabric doctor --cite-coverage`)只能事后统计,不影响实时行为

**Verdict**:**NEEDS-3-POLISH** (与 algo audit §1 + NEW-1 + NEW-18 一致)

**Recommendations**:
1. PreEdit warn hook — `Edit/Write` 前 spot check 最近 N turn `KB:` 行存在性,缺则 stdout JSON warn
2. cite-policy-evict default ON,interval=10
3. cite 简化 4-state → 2-state(已 algo audit)

---

## Stage 4 — archive (fabric-archive Skill)

**入口**:用户显式 / hook nudge / AI self-archive marker
**期望产出**:`.fabric/knowledge/pending/<type>/<slug>.md` 落地

**衔接到 Stage 5**(archive 后是否 review):
- ✅ archive 末尾返回 `pending_path`,但**没有引导用户跑 fabric-review**
- ⚠ 大量 archive 不 review → pending/ 累积 → Stop hook signal C 提醒(7 天/10 条阈值后)— 但 7 天延迟过长

**衔接到 Stage 3**(用户 cite 了一个待 review 的 pending id):
- ❌ pending KB 的 id 是临时 slug,**未经 review approve 的 id 不该被 cite** — 但 cite policy 没明示这一约束
- 用户/AI 可能 cite pending id → review 后 id 变化(layer flip) → 旧 cite 失效

**Dead-end 风险**:**MED** —— archive 后路径不明
- 用户视角:archive 完看到 "落地 pending/decisions/foo.md",**不知道是否要立即 review,还是等 hook 提醒**

**Verdict**:**NEEDS-2-POLISH**

**Recommendations**:
1. archive 末尾加 `pending_path: ... | 建议:回复 /fabric-review 立即审,或等 hook 提醒` 引导
2. cite policy 加约束:`KB:` 首行不应引用 `pending/` 路径下的 id;若引用则 reminder warn
3. pending 累积阈值从 10/7d 降到 5/3d,缩短累积窗

---

## Stage 5 — review (fabric-review Skill)

**入口**:Stop hook nudge / 用户显式
**期望产出**:pending entry → approved 进 `knowledge/<type>/` 或 rejected 删除

**衔接到 Stage 6**(review 后 doctor 是否暴露问题):
- ✅ approve 触发 `knowledge_promoted` event + counter bump
- ⚠ approve 后 `doctor` 如果 detect drift(meta vs disk),用户**不知道 review 引发的**

**衔接到 Stage 3 + 4**(review 后 cite 的同一 id 可能 layer-flip):
- ❌ layer-flip 会变 stable_id (`prior_stable_id` → `new_stable_id`),**旧 session 的 cite 自动失效**;skill 只是 surface 提示用户,**没缓存自动 propagate**

**Dead-end 风险**:**MED** —— review 后旧 cite 失效用户难追

**Verdict**:**NEEDS-2-POLISH**

**Recommendations**:
1. layer-flip 后 server 端 emit `knowledge_id_redirect` event,记 prior→new mapping
2. `fab_plan_context` 接收旧 id 时,server 透明 redirect + warn 调用者「id 已迁移到 new」
3. review 末尾建议 `cite-coverage` 跑一次确认旧 id 没残留

---

## Stage 6 — doctor (`fabric doctor` / `--fix`)

**入口**:用户显式 / Stop hook Signal D (>14d 没跑)
**期望产出**:35 check 报告 + remediation 文案

**衔接到 Stage 7**(doctor 提示用户 upgrade):
- ⚠ 部分 check 命中后 remediation 引导跑 `fabric install --force-skills-only` 或 `fabric install`(upgrade) — 但不所有 check 都路由到 install
- ❌ 部分 remediation **引导用户删 ledger / 删 .fabric/**(rc.32 测出 2 条反例)—— 危险

**衔接到 Stage 8**(doctor → drift detection):
- ✅ doctor 35 check 含 drift 检测(hooks_wired / meta_drift / skill_drift)
- ⚠ drift 检出后,remediation 通常是 `fabric install` 但**没强制流程引导**

**Dead-end 风险**:**HIGH** —— doctor 报告 35 issue 时用户疲劳,**不知道哪些是 critical**
- 当前 issue level 是 error/warn/info 三级,但用户视角是一个长列表
- 70 个 remediation 文案 (35 × 2 locale)质量参差(rc.36 部分修)

**Verdict**:**NEEDS-3-POLISH** (与 algo audit §9 + NEW-8 + NEW-20 一致)

**Recommendations**:
1. 删高危 remediation(NEW-8)
2. doctor 输出加 **TL;DR top-3 most-critical issues** 头部,而非一上来 35 个
3. doctor `--check-hooks` runtime health(NEW-20)

---

## Stage 7 — upgrade (`fabric install` 二次跑 / `--force-skills-only`)

**入口**:fabric 版本升级 / doctor drift remediation 引导
**期望产出**:hooks / skills / MCP config 更新到最新版本

**衔接到 Stage 8**(upgrade 触发 drift detection):
- ⚠ install 检测到本地 hook 文件被改 → preflight lock + abort(rc.15 行为)
- ❌ 当前没 `--force-hooks-only` flag(推 rc.37) — 用户 stuck

**衔接到 Stage 1**(upgrade 失败回到 install):
- ⚠ upgrade mid-step 失败 → 与 Stage 1 相同 partial-state 问题

**Dead-end 风险**:**HIGH** —— 本地 drift 无法非破坏性升级
- 用户在 hook 加了自定义日志 → upgrade abort → 用户必须手动 revert 本地修改才能升

**Verdict**:**NEEDS-2-POLISH**

**Recommendations**:
1. `fabric install --diff-hooks` 显示本地 vs 新版差异,让用户选 keep-local / overwrite
2. `fabric install --force-hooks-only` flag(rc.37 已 task,可拉前)
3. 与 [[fabric-serve-quarantine-not-delete]] decision 协同 — install 不再 check serve lock 后,upgrade 路径简化

---

## Stage 8 — drift (hook/skill drift detection)

**入口**:doctor 跑 / install 跑 / runtime fail
**期望产出**:drift 标识 + remediation

**衔接到 Stage 1 + 7**:
- ✅ drift detect → 引导 reinstall / `--force-skills-only`
- ⚠ skill drift detect 在 server 端 (rc.31 加 hooks_wired check),但 hook 内容 drift (用户改了 hook .cjs)**没自动 detect**
- ❌ skill 文件被改、AGENTS.md 被改、hook 被改 — 各类 drift 散在不同 check,**没统一 view**

**Dead-end 风险**:**MED** —— drift 反复出现用户不知道根因

**Verdict**:**NEEDS-2-POLISH**

**Recommendations**:
1. doctor 加 `drift_summary` 头部 — 把所有 drift 类(hooks / skills / AGENTS.md / meta)集中报告
2. `fabric doctor --check-hook-content` 加 sha256 比对 templates/hooks 与本地

---

## 全 8 阶段 Coherence Matrix

| Stage | Verdict | Top dead-end / coherence break |
|---|---|---|
| 1 install | NEEDS-1 | partial-state recovery 不明 + 重启 client 不显式 |
| 2 discover | NEEDS-2 | **KB 索引列完无下一步引导**(HIGH) |
| 3 cite | NEEDS-3 | **cite hallucination 无 catch + 3.1% 遵循率政策弱**(HIGH) |
| 4 archive | NEEDS-2 | archive 后是否 review 不明 |
| 5 review | NEEDS-2 | layer-flip 后旧 cite 失效用户难追 |
| 6 doctor | NEEDS-3 | **35 issue 无 TL;DR + 部分高危 remediation**(HIGH) |
| 7 upgrade | NEEDS-2 | **本地 drift abort 无非破坏性升级路径**(HIGH) |
| 8 drift | NEEDS-2 | drift 散在多 check 无统一 view |

**致命 coherence break**:
- Stage 2 → 3:用户看到 KB 索引但没引导 cite — 信号丢失
- Stage 3 → 4:cite 后没机制催 archive — 反馈闭环断
- Stage 6 → 7:doctor 报错指 install 但 install 又 abort drift — 死循环
- Stage 7 → 1:partial state recovery 不明 — 用户卡 mid-state

**rc.32 baseline 5% reach goal 印证**:旅程 break 在 Stage 2-3 之间(用户开 session 看到索引但没引用)就直接 funnel 流失 95%。

---

## 新 GA fix candidate(C5 阶段)

| ID | 来源 | 建议位置 |
|---|---|---|
| **NEW-22** | install 加重启提示 + partial-state recovery | Wave D 新 task |
| **NEW-23** | SessionStart 索引末尾加 "下一步" 引导 | Wave D(NEW-2 配套) |
| **NEW-24** | layer-flip 后 server emit `knowledge_id_redirect` + plan_context 透明 redirect | Wave A1 配套 |
| **NEW-25** | doctor 输出加 TL;DR top-3 critical 头部 | Wave D(NEW-8 配套) |
| **NEW-26** | install `--diff-hooks` + `--force-hooks-only` flag | Wave D(rc.37 拉前) |
| **NEW-27** | doctor `drift_summary` 头部统一 view + `--check-hook-content` sha256 比对 | Wave D 新 task |

**估时增量**:NEW-22~27 共 ~6-10h。

**总估时**:~88-120h → **~94-130h**。

---

## 下一步

继续 C6 Phase 6 5 横切 spot-check → `crosscut-verdict.md`
然后 C7 Phase 7 GA-VERDICT 汇总。
