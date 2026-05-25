# Skill Design Guide

How to write Fabric skill (SKILL.md) `description:` frontmatter so the host LLM (Claude Code / Codex CLI / Cursor) reliably auto-invokes your skill when the user's prompt fits.

> **Audience**: Anyone authoring a new skill under `packages/cli/templates/skills/<slug>/SKILL.md` or revising an existing one. The auto-invoke contract is the highest-leverage UX surface in Fabric — a sloppy description is the #1 cause of "I asked for X but the skill didn't fire" reports.

## TL;DR

```yaml
---
name: fabric-archive
description: |
  把当前对话里值得记的 decision/pitfall/pattern 归档到 .fabric/knowledge/pending/。
  Triggers: 以后/always/never/from now on/下次注意 等 normative 短语;
  wrong-turn-and-revert (尝试 X 后改走 Y); 用户在 ≥2 候选间锁定方向;
  显式拒绝建议并说原因。Use when capturing knowledge — NOT for code review.
---
```

Four rules:

1. **<60 tokens** — chars/3 estimate ≤ 180. Host LLM auto-invoke matchers reason over the FULL description text; longer = lower signal density.
2. **Bilingual triggers** — at least one CJK phrase AND at least one ASCII phrase. CJK-speaking users say "以后记得", English users say "from now on". Skill must trigger on both.
3. **Exclusion clause** — explicit "NOT for X" line when the slug name is ambiguous. `fabric-import` needs `(not for code/data import)` because "import" is overloaded.
4. **Verbs over nouns** — describe ACTIONS that should trigger ("把对话归档" / "approve pending knowledge"), not topics ("knowledge management system").

The `doctor.check.skill_description` lint enforces rules 1+2 statically. Rules 3+4 are review-time judgment.

## Anatomy

```yaml
description: |
  <1-line purpose: what the skill DOES, present tense imperative>
  Triggers: <CJK trigger 1>; <CJK trigger 2>; <English trigger 1>; <English trigger 2>.
  Use when <positive scope>, NOT for <out-of-scope>.
```

### Purpose line

Lead with the verb. The host LLM picks "what does this skill do?" from the first sentence.

| ❌ Bad | ✅ Good |
|---|---|
| "A skill for managing knowledge entries" | "把对话里值得记的决策/陷阱归档到 pending" |
| "Knowledge review and curation system" | "审 pending knowledge: approve / reject / modify / defer" |
| "Import existing decisions from a repo" | "从 git 历史 + 现有文档挖出 decision/pitfall 回灌 fabric" |

### Triggers

List the **literal phrases users say** when they want this skill. Mix:
- Normative language: 以后 / 下次注意 / always / never / from now on
- Action verbs: 归档 / 审批 / 驳回 / approve / archive / mine
- Skill name aliases: fab archive / fabric-archive / /fabric-archive
- Domain phrases tied to the skill's job

The W1 verify (gemini analysis @ `.workflow/.scratchpad/rc33-plan/W1-VERIFY-RESULT.md`) is the canonical test: 20 scenarios, target recall ≥ 80% per skill. See [W1 verify scenarios](../.workflow/.scratchpad/rc33-plan/W1-VERIFY-SCENARIOS.md) for the format.

### Exclusion clause

Required when the slug name overlaps with common dev vocabulary:

| Slug | Ambiguity | Exclusion |
|---|---|---|
| fabric-import | "import" = ES module import, CSV import, DB import | `NOT for code/data import` |
| fabric-review | "review" = code review, PR review | `NOT for PR / code review` |
| fabric-archive | "archive" = tar.gz, git archive | (less ambiguous, optional) |

Without the exclusion clause the host LLM will fire your skill on unrelated prompts like "review this PR" or "import this CSV file" — false positives the user has to manually dismiss.

## Token budget

- **Target**: < 60 tokens (chars/3 estimate ≤ 180 chars for CJK-heavy markdown)
- **Reason**: host LLM's auto-invoke matcher reasons over the FULL description. Long descriptions dilute the trigger signal — recall drops below 70%.
- **Counter-pressure**: you want enough triggers to cover all phrasings. Compromise: list the 3-5 most likely trigger phrases verbatim, drop the rest.

The `doctor.check.skill_token_budget` lint (warn > 5K, error > 10K) covers SKILL.md body size, not the description. Description size is enforced separately by `doctor.check.skill_description` (warn > 60 tokens).

## Verifying recall

Static lints catch structural defects. **Real trigger recall requires a live LLM**:

```bash
# Re-run the W1 gemini verify pattern on your skill:
maestro delegate "PURPOSE: Verify <skill-name> description triggers ≥80% recall on 20 scenarios | TASK: Read <skill>/SKILL.md frontmatter description | Predict for 20 prompts whether host LLM would auto-invoke | Report confusion matrix + F1
MODE: analysis
CONTEXT: @packages/cli/templates/skills/<skill>/SKILL.md
EXPECTED: per-scenario prediction table + F1 + recall + recommendations
" --to gemini --mode analysis
```

Save the report under `.workflow/.scratchpad/<your-context>/<skill>-VERIFY-RESULT.md`. Aim for:
- recall ≥ 80% (catches the typical case)
- precision ≥ 90% (don't fire on out-of-scope prompts)
- F1 ≥ 85%

## Anti-patterns

| Pattern | Why it hurts | Fix |
|---|---|---|
| Description = slug name verbatim | Zero signal | List 3-5 trigger phrases |
| All-English description for CJK-user-base skill | Misses 半数 prompts | Add CJK triggers |
| Marketing prose ("powerful skill for...") | Wastes tokens | Lead with verb |
| > 200 chars / > 60 tokens | Recall drops | Cut to top 5 triggers |
| Missing exclusion on ambiguous name | False-positive fires | Add `NOT for X` |
| No example phrases | Host LLM guesses | Include literal user-said phrases |

## Cross-references

- `doctor.check.skill_description` — static lint (non-empty / token budget / bilingual)
- `doctor.check.skill_token_budget` — SKILL.md body size (>5K warn / >10K error)
- W1 verify result: `.workflow/.scratchpad/rc33-plan/W1-VERIFY-RESULT.md` (canonical example: archive recall 85.7% PASS)
- W4-C5 follow-up: `.workflow/.scratchpad/rc33-plan/W4-C5-EVAL-RESULT.md` (fabric-review + fabric-import recall analysis)
- [SKILL.md progressive disclosure pattern](configuration.md) — when SKILL.md body grows past 5K, sink detail into `ref/<phase>.md`
