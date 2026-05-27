# Werewolf Dogfood Findings (Simulated, rc.36 baseline)

**Date**: 2026-05-27
**Method**: `cd ~/Desktop/projects/werewolf-minigame && fabric doctor` 实跑
**Comparison**: 对 paper audit verdict 验证 + 补漏

---

## fabric doctor 实跑结果

✅ 大部分 35 check 绿(基础完整性 OK)
⚠ 7 个 warn 暴露 paper-miss 项

### Warn 1:Cite-policy Goodhart pattern(**致命**)

`KT-MOD-0017 repeated as [recalled] 32x in 7d` — Goodhart's law 真实出现

**含义**:cite policy 实测有 over-fitting 模式 — AI 反复引同一 id 来"刷"遵循率,违背政策原意。
**Paper miss**:audit §1 cite policy 没识别这个模式(只测了 3.1% 遵循率,没测 Goodhart)
**与 NEW-1 关系**:NEW-1 简化 cite policy 4-state → 2-state 可能加剧此模式;**应该顺手加 doctor anti-goodhart lint**

### Warn 2:Knowledge draft backlog 100%

45/45 canonical entries 卡 draft maturity — **rc.32 baseline 92% → 100% REGRESSION**

**含义**:archive 写得多 / review 没跟上 / 没有 auto-promote
**Paper miss**:audit §5 fabric-review 没识别 promote 断流的严重性
**与 NEW-12 关系**:fabric-review mode 简化要包含 "batch promote" 路径,允许一次升一组 draft

### Warn 3:Knowledge tags coverage 0%

45/45 entries tags 为空 — 主题聚类失效

**含义**:archive skill 没产 tag,review approve 也没补 tag
**Paper miss**:audit Skills §1 fabric-archive 没要求 tag 字段(检查 fab_extract_knowledge schema 是否有 tags — 上面 mcp tool schema 里 **没有 tags 字段**!)
**Action**:扩 fab_extract_knowledge schema 加 tags + skill 产 2-4 个 kebab-case tag

### Warn 4:Knowledge drift unconsumed

31 drift detected / 0 demote — KB 缓慢失活

**含义**:drift 标了但没有 demote pipeline 消化
**与 NEW-5 / NEW-25 关系**:NEW-5 personal layer lint + NEW-27 drift_summary 接近,但**自动 auto-demote** 在 rc.36 没做。**应纳入 rc.37 Wave D**

### Warn 5:Knowledge summary opaque 90%(**致命!**)

**45/50 entries summary 等于 stable_id** — narrow hint 输出变成 `<id> · <id>` 而非真实摘要

**含义**:archive skill 产的 summary 字段被 stable_id 替代,导致 narrow hint 在用户视角是 noise
**Paper miss**:audit §1 cite policy 提到 "AI 容易忘",但**实际根因之一是 summary 不可读 → AI 看不到内容信号 → 主动跳过 fetch → cite 流失**
**与 NEW-1 关系**:NEW-1 PreEdit warn hook 对 opaque summary 也无能为力 —**先修 summary,再修政策**
**Action**:扩 fab_extract_knowledge 加 summary 校验(summary 不能等于 stable_id)+ archive skill 强制 summary minLength 30 chars

### Warn 6:Promote ledger invariant 破坏

knowledge_proposed=20 < knowledge_promote_started=49 — 部分 pending 在 approve 时**绕过 fab_extract_knowledge**

**含义**:legacy entry 或 manual edit 进入 pending → fab_review approve 时没 knowledge_proposed event → ledger 不变量破坏
**Paper miss**:audit §5 review 没测 ledger invariant,但**这是 promotion 治理的根本问题**
**Action**:doctor lint + 修复路径(强制 approve 前补 propose event)

### Warn 7:Meta manual diverged

1 entry on disk missing — `fabric doctor --fix` 可修

**含义**:routine drift,non-critical
**Action**:standard --fix 路径

---

## 与 paper audit 对照

| Paper finding | Werewolf 实测 | 一致性 |
|---|---|---|
| §1 cite policy 3.1% adherence | 实测有 Goodhart 模式 (32x recall 同 id) | ✓ 对齐 + 加 anti-goodhart 维度 |
| §2 self-archive 20% recall | events.jsonl 95% 是 turn_observed,真正 propose 只 20 个 — 印证 recall 低 | ✓ 对齐 |
| §6 doctor 35 check 高危 remediation | 看到 cite_goodhart 标 "maintainer-only remediation" — **有意 hide,但用户视角 confusing** | 部分对齐 + 新维度:remediation visibility level |
| 8 stage journey coherence | 第 5 stage(review)实测 promote 断流 100% — 死路径明确 | ✓ 强 confirm |
| §9 doctor remediation 文案 | "调 /fabric-review 批量审 draft entries" 引导 OK / "运行 fabric doctor --fix" 直接命令 OK / "rc.37 计划上线自动 14-day demote" 引用未来计划 — **用户视角是承诺,GA 不能这样写** | ⚠ 新发现:remediation 引用未来 rc 是 anti-pattern |

---

## 新 paper-miss 项(NEW-36 ~ NEW-40)

| ID | 内容 | 严重 | 建议位置 |
|---|---|---|---|
| **NEW-36** | doctor anti-goodhart lint:同 id [recalled] 7d 内 > 阈值 → warn(已存在但增强) | P1 | rc.37 Wave D(NEW-1 配套) |
| **NEW-37** | fab_extract_knowledge schema 加 `tags` 字段 + summary 校验(≥30 chars,!=stable_id)| **P0** | rc.37 Wave A 配套 |
| **NEW-38** | Knowledge auto-promote pipeline(draft ≥ 14d + no drift → auto-promote verified) | P1 | rc.37/rc.38 Wave D |
| **NEW-39** | Promote ledger invariant 修复路径(approve 缺 propose 时 server 自动补 event 或 reject)| P1 | rc.37 Wave A 配套 |
| **NEW-40** | doctor remediation 文案禁引用未来 rc(`rc.37 计划上线...` → 改为 "当前 manual 路径 + 后续 release 自动化") | P1 | rc.37 Wave D(NEW-8 配套) |

**估时增量**:NEW-36~40 共 ~5-8h

**总估时**:~102-142h → **~107-150h**

---

## Paper audit 重要更新

1. ✅ Wave A1 删 selectable filter 真的解决 374→7→1 问题 — 但 werewolf 实测 KB summary 90% opaque,即使返全候选 LLM 看到的也是一堆 `KT-XXX · KT-XXX`(NEW-37 必修才能真见效)
2. ⚠ Cite policy 不只是遵循率低,还有 Goodhart pattern — NEW-1 重写时要顺手加 anti-pattern lint
3. ⚠ Promote ledger invariant 破坏 — ledger-as-source-of-truth 被破坏,rc.37 修

**结论**:Wave A1 + NEW-37 + NEW-39 是真正的 GA 解锁套路(光删 filter 没用,还得让 summary 可读 + 让 ledger 不变量稳)。
