# W1-V — 20 Scenario Recall Test Set

> 用于跨 LLM 评估 fabric-archive / fabric-review / fabric-import 的 description recall。
> Baseline (rc.32-eval): fabric-archive recall = 20%。Goal: ≥ 80% (即 ≥ 60 pct 提升)。

## Skill descriptions under test (rc.33)

### fabric-archive
```
Archive session insights to .fabric/knowledge/pending/. Trigger on normative language (以后/always/from now on/下次/never/记一下/永远不要/from now), wrong-turn-and-revert reflections, decision confirmations with rationale, or explicit dismissals with reason; also Stop-hook archive signals or explicit /fabric-archive invocation.
```

### fabric-review
```
Review entries in .fabric/knowledge/pending/ only (NOT PR/code review) — list / approve / reject / modify (incl. layer flip) / search / defer. Trigger on 审批/批准/驳回/修改/复审/list pending/approve/reject/review pending knowledge.
```

### fabric-import
```
Cold-start enrich .fabric/knowledge/ from project git log + docs/*.md as broad+[] pending entries (NOT for code/data/module import). Trigger on 导入历史/bootstrap fabric/mine changelog/import knowledge from git/挖掘 commit/挖掘文档.
```

## 20 scenarios (10 positive + 7 negative + 3 boundary)

| # | Prompt | Expected skill | Category |
|---|---|---|---|
| 1 | "以后记得用 jittered exponential backoff" | fabric-archive | positive (normative 以后) |
| 2 | "from now on always check the lock file before deploy" | fabric-archive | positive (normative) |
| 3 | "let's call this the wave-1 DAG pattern" | fabric-archive | positive (new pattern emergence) |
| 4 | "I tried memoization but reverted — recompute is simpler" | fabric-archive | positive (wrong-turn-and-revert) |
| 5 | "between Promise.all and a queue, queue wins for backpressure" | fabric-archive | positive (decision-confirmation) |
| 6 | "审批 pending 的 K-007" | fabric-review | positive (审批) |
| 7 | "approve the pending knowledge entry on retry pattern" | fabric-review | positive (approve pending) |
| 8 | "驳回 K-007 这条 pitfall 没价值" | fabric-review | positive (驳回) |
| 9 | "import knowledge from git history into fabric" | fabric-import | positive (import knowledge from git) |
| 10 | "bootstrap fabric on this existing repo, mine the changelog" | fabric-import | positive (bootstrap fabric / mine changelog) |
| 11 | "review this pull request for me" | NONE | negative (PR review — excluded by fabric-review) |
| 12 | "do a code review on src/auth/*.ts" | NONE | negative (code review — excluded by fabric-review) |
| 13 | "import users from this CSV file into the database" | NONE | negative (data import — excluded by fabric-import) |
| 14 | "import the auth module from packages/server/auth" | NONE | negative (code/module import — excluded by fabric-import) |
| 15 | "import-style: change tsconfig moduleResolution to bundler" | NONE | negative (style/config, not knowledge import) |
| 16 | "fix this typo in the README" | NONE | negative (typo-only — anti-archive signal) |
| 17 | "run the test suite" | NONE | negative (no fabric signal) |
| 18 | "save this insight to fabric" | fabric-archive | boundary (implicit archive intent — should match on "save insight to fabric") |
| 19 | "fab archive" | fabric-archive | boundary (explicit invocation) |
| 20 | "list all pending knowledge" | fabric-review | boundary (list pending) |

## Evaluation criteria

For each scenario, the evaluating LLM judges which of {fabric-archive, fabric-review, fabric-import, NONE} the user prompt most likely activates GIVEN ONLY the description string above. The judgment must be based solely on the description text (no other context).

**Metric definitions:**

- **Recall (per-skill)** = (correctly-predicted positives) / (total expected positives for that skill).
- **Precision (per-skill)** = (correctly-predicted positives) / (total predictions for that skill, positive or negative).
- **F1** = harmonic mean of precision + recall.

**Goal gates:**

- fabric-archive recall ≥ 80% (vs rc.32 baseline 20%).
- fabric-review F1 ≥ 85%.
- fabric-import F1 ≥ 85%.

If any gate fails → iterate descriptions before tagging rc.33.

## Result placeholder

(Filled by maestro delegate gemini callback — see W1-VERIFY-RESULT.md)
