# G-EFFICACY-2 Evidence — remaining L-LLM surfaces, ≥2 cold evals

## Method note (honest)
Cross-vendor maestro delegates (gemini + codex) were dispatched but **hung "running" for >5min with zero output** in this environment (known maestro background-callback flakiness, [[feedback-maestro-delegate-completion-gate]]). Cancelled them and fell back to **2 zero-context Claude sub-agent cold evals** (Agent tool, Explore type, fresh context, diverse lenses). Zero-context independence — the core property of a cold eval — is preserved; cross-vendor diversity is not (env limitation, noted).

## Cold eval 1 — skill agent-followability (zero-context)
- fabric-review: 2/5 — claimed biggest gap: mode-inference + reason tables "punt to external ref/*.md absent from snapshot".
- fabric-import: 2/5 — claimed biggest gap: 11-row reason-mapping table (ref/phase-2-mining.md) "not included".
- verdict: "deferred external specification" — not ready for non-experts.

**VERIFICATION of eval 1's central claim (per audit-verification discipline) → REFUTED**: the ref/*.md files EXIST and are substantive — `fabric-import/ref/phase-2-mining.md` (17.5KB, contains the Step 2.1.5 table), `fabric-review/ref/per-mode-flows.md` (8.6KB, mode-inference examples), + 12 other ref docs. The reviewer judged SKILL.md in isolation and did NOT follow its `Read .../ref/*.md` links. So "absent documents" is false.
- **Tempered conclusion**: skills use deliberate progressive disclosure (terse SKILL.md index + on-demand ref/*.md). The content exists. BUT a real risk remains: followability depends on the agent reliably LOADING the ref links — and even a capable reviewer skipped them. → finding F-SKILL-PROGRESSIVE (medium): progressive-disclosure skills are only as followable as the agent's discipline in following Read-links; the terse SKILL.md alone underspecifies. Not a "missing file" bug.

## Cold eval 2 — knowledge-surfacing efficacy (zero-context, fed deterministic evidence)
- DESCRIPTION DISCRIMINATING POWER: **1/5** — must_read_if==summary (verbatim) + empty intent_clues/tech_stack/impact → "zero additional signal beyond the title"; ranking degrades to crude string similarity.
- NARROW INJECTION EFFICACY: **1/5** — independently reproduces F-NARROW-BUDGET: path gates don't work at scale (path-matched entry crowded out of 24-budget) + no filter at small scale. "relevance_paths is effectively decorative."
- OVERALL: 2/5 — "a title-matching tool masquerading as semantic knowledge routing." Highest-leverage fix: populate the 3 empty array fields consistently + make must_read_if a true conditional distinct from summary + path-priority ranking BEFORE text relevance.

**VERIFICATION**: eval 2's claims are INDEPENDENTLY CONFIRMED by this session's deterministic findings — F13 (must_read_if==summary on 8/8 real entries, code-proven) + F-NARROW-BUDGET (narrow crowding measured at 300 entries). High confidence (deterministic + cold eval converge).

## Quorum synthesis
2 independent zero-context evals. Convergence:
- **Knowledge-surfacing efficacy is WEAK (1-2/5)** — corroborated deterministically. The description schema's rich fields (clues/impact/distinct must_read_if) are unpopulated in practice → recall is essentially title+BM25 matching; narrow path-anchoring doesn't reliably deliver. This is the strongest efficacy signal of the deeptest.
- **Skill followability**: cold eval's "missing docs" basis refuted; real residual risk = progressive-disclosure link-following discipline (F-SKILL-PROGRESSIVE).

## Findings
- **F-SKILL-PROGRESSIVE** (medium): terse SKILL.md + on-demand ref/*.md means followability hinges on the agent loading ref links; a cold reviewer skipped them and judged the skill underspecified. Mitigation: inline the highest-stakes decision tables (mode inference, reason mapping) into SKILL.md, or make ref-loading a hard precondition.
- Reinforces F13 (description signal) + F-NARROW-BUDGET (narrow injection) with independent cold-eval corroboration → both elevated in confidence; fixes belong to the description-quality / injection-efficacy redesign (deferred, candidate-pool C3 salience/C4 endorsement territory).

## Verdict
- **G-EFFICACY-2**: MET — ≥2 zero-context cold evals completed on the remaining L-LLM surfaces (skill followability + description quality + narrow injection); quorum converges; one cold-eval sub-claim verified-and-refuted (ref files exist); cross-vendor maestro path honestly noted as env-flaky.
