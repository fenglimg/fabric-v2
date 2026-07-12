# Knowledge maturity lifecycle

**Vocabulary (only):** `draft` · `verified` · `proven`  
Legacy aliases such as `stable` / `endorsed` are **not** live maturity values (KT-DEC-0005).

**Axis:** maturity is a **reviewer judgment** about evidence and durability — **not** a usage-count score. High consumption can still leave a weak draft; low consumption is not proof of rot.

## Promote: draft → verified → proven

| Step | When | How |
|------|------|-----|
| **draft → verified** | Claim is clear, in-scope, not a near-duplicate; evidence / rationale holds under human review | `/fabric-review` → `fab_review` **approve** (pending) or **modify** with `maturity: verified` |
| **verified → proven** | Repeated successful application, foundational value, or structural centrality — still human judgment | `fab_review` **modify** → `maturity: proven` |

Pending archive output starts as **draft**. New entries reach canonical **only** via the pending→review path (`fab_propose` then `fabric-review` / `fab_review` approve). Maturity promotion (`draft` → `verified` → `proven`) is always explicit human/review judgment — not a silent counter threshold and not default LLM bulk auto-promote.

## Retire (deprecate-over-delete)

Use **`fab_review` action=`retire`** (or fabric-review **retire** sub-flow) when the entry is superseded, wrong-scope, or no longer true. Prefer deprecate-in-place over hard delete so history and cite paths stay recoverable.

## Doctor → review routing

`fabric doctor` surfaces quality signals (long **draft backlog**, zero-consumption candidates, stale draft archive, decay) with remediations that point at **`/fabric-review` / `fab_review`**. Doctor does **not** auto-promote or auto-retire store knowledge (report-first; KT-DEC-0007).

## Out of scope (D4-5)

**No default LLM-judge bulk auto-promote.** Cold-eval / multi-LLM checks may **nudge** summary quality at review time; they must not flip maturity for the whole corpus without human action.

## Related

- User path: `docs/USER-QUICKSTART.md`
- Review skill: `fabric-review` (approve / modify / retire)
- Schema census: `packages/shared` MaturitySchema + knowledge-enum-census tests
