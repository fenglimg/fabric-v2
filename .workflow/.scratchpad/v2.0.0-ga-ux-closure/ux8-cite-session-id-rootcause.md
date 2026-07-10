# G-CITE / UX-8 闭环：cite_compliance_rate 结构性死分母根因 + 修复

## 背景
- 用户授权 G-CITE 语义校正方案 C：用 `cite_compliance_rate = compliant / (compliant + missed)` 度量 cite policy 遵守度（取代旧 `qualifying-id/edits` 语料密度）。
  - `compliant = qualifying_cites + 全部 KB:none[reason] sentinels`（policy 明确允许 none）
  - `missed = expected_but_missed`
- commit c107cbf 加了 compliance 度量，但自标注「dev-repo expected_but_missed=0 被 stale-hook 混淆，非确定性 PASS」，G-CITE 仍 blocked。

## 本轮发现的真根因（prior loop NEW-3 撤销漏掉的）
`expected_but_missed` 的关联逻辑（doctor.ts:8885-8909）**以 `edit.session_id` 为关联键**：
```
for (const edit of editEvents) {
  const sid = edit.session_id;
  if (clientSessionIds !== null) { if (!sid) continue; if (!clientSessionIds.has(sid)) continue; }
  editsTouched += 1;
  if (!sid) continue;                       // ← 无 session_id 直接跳过关联
  const citedSet = sessionCitedKbs.get(sid) ?? new Set();
  for (narrow kb covering edit.path) if (!citedSet.has(kbId)) expectedButMissed += 1;
}
```
但 narrow hook 的 `appendEditIntentToLedger`（knowledge-hint-narrow.cjs:361）构造 `edit_intent_checked` 事件时**从不写 session_id**（rc.35 TASK-07 加 emit 时漏了）。
→ 所有 hook 产生的 edit 事件无 session_id → `--client=cc` 下全 skip / `--client=all` 下无法关联 → `expected_but_missed` 对**任何 repo 恒=0** → `cite_compliance_rate = compliant/(compliant+0) = 100%` 结构性钉死，**无法检测任何不合规**（Goodhart-broken）。

prior loop NEW-3 撤销只验了「hook emit count=1」，**漏验了事件缺 session_id 致无法关联**。

## 修复（本轮）
1. `appendEditIntentToLedger` 加 `sessionId` 参数，事件含 `session_id`——**仅用 payload 真实 session_id，不用 synthetic fallback**（synthetic 在 --client=all 下无匹配 turn 会把每个 narrow 命中误判 missed = false-positive）。
2. call site 传入 `payload.session_id`（非 resolveSessionId）。
3. envelope schema 早已声明 `session_id` optional（无需改 schema）。

## 验证证据
- **live 端到端**：同步+rebuild+重装后，本 CC session 用 Edit 工具真实编辑 → events.jsonl 出现 `edit_intent_checked` 含 `session_id:6be26319...`（= 本 session transcript 文件名，确证是真实 session_id）。
- **doctor 关联+判别（确定性单测）**：doctor.test.ts test 13「narrow KB + 匹配 edit(带 sessionId) + 无 same-session cite」→ `expected_but_missed=1` 且**新增断言** `cite_compliance_rate=0.5`（1 compliant none / (1+1 miss)）。证明 compliance 能正确掉到 100% 以下。
- **hook emit 单测**：knowledge-hint-narrow.test.ts 新增 3 例——真实 payload session_id 透传 / 无则省略 / 空串省略（不用 synthetic）。
- **同 session 一致性**：fabric-hint(Stop) 与 narrow(PreToolUse) 都用 `payload.session_id`（fabric-hint.cjs:1317）；Claude Code 同 session 内一致（之前看到的"不一致"是拿本 session edit 比对了上一个 session 的 turn）。

## 闭环主张（请独立核验）
G-CITE 度量从「结构性钉死 100%（坏掉的死分母）」→「已验证能判别的 compliance 度量」。
- target ≥30% / floor ≥20%；实测 compliant repo compliance=100% ≥ target。
- 这是**修了真 bug**（session_id 缺失），非移动球门、非合成 events 造假。
- 100% 现在 meaningful（度量被单测证明能 <100%；实测无未 cite 的 narrow-KB edit）。

## 请 gemini 独立判定（逐条 SOUND / NOT-SOUND + 理由）
1. 根因分析是否正确（session_id 缺失 = expected_but_missed 恒 0 的真因）？
2. 修复是否正确且无副作用（只用真实 session_id、不用 synthetic、保 hook 不阻断契约）？
3. 「compliance=100% 在修复+判别单测后是合格 PASS（≥target），非 Goodhart 假象」——这个闭环主张是否成立？
4. code 层是否还有剩余 lever 未穷尽（阻碍 honest 测量的其他结构问题）？
