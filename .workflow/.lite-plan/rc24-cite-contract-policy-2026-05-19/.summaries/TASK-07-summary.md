# TASK-07: knowledge-meta idTypeMap loader for doctor cite-coverage routing

## CRITICAL contract decision — singular knowledge_type (NO normalization)

**`loadKbIdTypeMap` returns `Map<string, KnowledgeType>` where `KnowledgeType` is the SINGULAR enum exported by `@fenglimg/fabric-shared` from `packages/shared/src/schemas/api-contracts.ts:897-903`:**

```ts
KnowledgeTypeSchema = z.enum([
  "model",
  "decision",
  "guideline",
  "pitfall",
  "process",
]);
```

**The TASK-05 summary's claim and the prompt's "CRITICAL FACT" stating that `KnowledgeTypeSchema` exports plural forms is INACCURATE for the current rc.24 codebase.** I verified `packages/shared/src/schemas/api-contracts.ts:897-903` directly — both the on-disk `agents.meta.json` storage AND the canonical `KnowledgeTypeSchema` use the SAME singular vocabulary. There is no boundary mismatch and **no normalization is performed** by the loader.

**Implication for TASK-08 (doctor cite-coverage)** — match against the SINGULAR enum literally:
- `decision` / `pitfall` → strict contract bucket (require operators or skip:reason)
- `model` → reference-cite bucket (no contract required)
- `guideline` / `process` → deferred-to-rc.25 LLM-judge bucket
- cite_id absent from the map → `cite_id_unresolved` bucket

If TASK-08 needs to defensively accept both singular AND plural for forward-compat (mirroring the TASK-05 hook lib's `CONTRACT_REQUIRED_TYPES = {decision, decisions, pitfall, pitfalls}` defensive set), that is the doctor's choice on consumption — the loader stays canonical and emits singular only. Test case `returns values from the canonical singular KnowledgeType enum (no plural drift)` asserts the singular contract explicitly so any future plural rename in the schema surfaces here as a test failure.

## Design choice — read .fabric/agents.meta.json directly (option B)

Implemented as a thin extract over the engine-maintained meta file rather than re-walking the knowledge filesystem. Rationale matches the task plan:
- meta is the engine's source of truth (kept in sync by `fab install` / `fab doctor --fix` / scan pipelines)
- single read syscall, no recursive scan
- no logic duplication with `computeKnowledgeBasedAgentsMeta`

Stale-meta risk is mitigated by the existing drift detection plumbing (rc.23 auto-heal); doctor cite-coverage will report all unknown cites as `cite_id_unresolved` if meta is missing/stale, which is the safe degraded mode.

## Changes

- `packages/server/src/services/knowledge-meta-builder.ts` (+49 LOC):
  - New `export async function loadKbIdTypeMap(projectRootInput: string): Promise<Map<string, KnowledgeType>>`.
  - Reads `.fabric/agents.meta.json` via the existing `readExistingMeta` helper (which itself wraps `agentsMetaSchema.parse(JSON.parse(raw))` and returns `undefined` on ENOENT, malformed JSON, or schema failure).
  - Iterates `meta.nodes`, filters by `isKnowledgeStableId(stable_id)` (matches `K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}`), reads `node.description.knowledge_type`, sets the Map entry.
  - Returns empty Map on every failure mode (missing file, malformed JSON, schema reject, missing description, missing knowledge_type field) — never throws.
  - Includes both team (KT-*) and personal (KP-*) entries automatically (they share the same `meta.nodes` map by design — dual-root scan merges them).
  - Skips legacy non-knowledge entries (e.g. `rules/legacy`) whose stable_id doesn't match the KP/KT pattern.

- `packages/server/src/index.ts` (+1 line):
  - Added `loadKbIdTypeMap` to the `from "./services/knowledge-meta-builder.js"` re-export block.

- `packages/server/src/services/knowledge-meta-builder.test.ts` (+~220 LOC, 6 new test cases in new `describe("loadKbIdTypeMap")` block):
  1. **team-layer KT-* entries with singular knowledge_type** — writes KT-DEC-0001 + KT-PIT-0001, runs `writeKnowledgeMeta`, asserts both surface with `"decision"` / `"pitfall"`.
  2. **dual-layer KT-* + KP-* entries** — writes a team model and a personal guideline under FABRIC_HOME tempdir, asserts both surface (verifies personal-layer parity per rc.24 B7 lock).
  3. **missing agents.meta.json** — no meta written; loader returns empty Map without throwing.
  4. **malformed JSON** — writes garbage to `.fabric/agents.meta.json`; loader returns empty Map without throwing.
  5. **missing description.knowledge_type / non-knowledge stable_id** — hand-crafted meta with one valid node, one node lacking `knowledge_type`, one legacy `rules/legacy` node. Asserts the loader includes the valid one, skips the two malformed/non-knowledge ones, size === 1.
  6. **singular enum canonical (no plural drift)** — writes one entry per knowledge_type (model/decision/guideline/pitfall/process), asserts each surfaces with the exact singular literal AND that no plural form appears anywhere in the map values. Failure of this test signals a schema-vocabulary breaking change.

## Verification

- [x] **knowledge-meta-builder.ts exports loadKbIdTypeMap function** — `export async function loadKbIdTypeMap(...)` at line 69; re-exported from `packages/server/src/index.ts:46`.
- [x] **Function returns Map<string, KnowledgeType>** — return type explicit in signature, `KnowledgeType` imported from `@fenglimg/fabric-shared`. Singular form. Documented in the function's JSDoc with a "Singular knowledge_type contract" section.
- [x] **Handles missing meta file gracefully (empty map, no throw)** — Test case (3) `returns an empty map when agents.meta.json is missing (graceful)` asserts size === 0 with no thrown error. Test case (4) covers malformed JSON.
- [x] **Includes both team (KT-*) and personal (KP-*) entries** — Test case (2) `includes personal-layer KP-* entries alongside team entries (dual-root)` asserts both `KT-MOD-0001` and `KP-GLD-0001` surface from the same meta read.
- [x] **knowledge-meta-builder.test.ts adds ≥5 loader test cases** — 6 new `it(...)` blocks under the new `describe("loadKbIdTypeMap")` (one over the minimum).
- [x] **pnpm --filter @fenglimg/fabric-server test exits 0** — 530 passed / 1 skipped across 33 files, 6.38s. Zero regressions; 6 new tests pass.
- [x] **TypeScript check** — function compiles with the existing imports (`KnowledgeType` was already in the import block from line 25; `isKnowledgeStableId` was already in the import block from line 13).

## Tests

- [x] `pnpm --filter @fenglimg/fabric-server test knowledge-meta-builder`: 27/27 pass (was 21; +6 new from this task).
- [x] `pnpm --filter @fenglimg/fabric-server test` (full): 530/530 pass (1 pre-existing skipped) across 33 files in 6.38s.

## Deviations

- **Plural-vs-singular framing in the user prompt + TASK-05 summary is outdated.** The current `KnowledgeTypeSchema` in `packages/shared/src/schemas/api-contracts.ts:897-903` is SINGULAR (matches the on-disk meta). No normalization is performed by the loader. I documented this prominently in the function JSDoc and at the top of this summary so TASK-08 (doctor) doesn't waste cycles on a non-existent boundary. The TASK-05 hook lib defensively accepts both forms — that's a hook-side runtime safety net; the server-side loader keeps the canonical singular contract.
- **Test for option-A (re-run knowledge-meta build) NOT added** — the task plan locked option B (read meta directly), so I tested only B-path behavior. The "stale meta" case is implicitly covered by tests 3+4 (which mimic the degraded-mode signal).

## Notes for TASK-08 (downstream consumer)

- **Match against SINGULAR enum literals**: `idTypeMap.get(cite_id)` returns `"decision" | "pitfall" | "model" | "guideline" | "process"` or `undefined`. Use:
  ```ts
  const kbType = idTypeMap.get(citeId);
  if (kbType === undefined) {
    bucket = "cite_id_unresolved";
  } else if (kbType === "decision" || kbType === "pitfall") {
    bucket = "contract_strict";
  } else if (kbType === "model") {
    bucket = "reference_only";
  } else {
    bucket = "deferred_llm_judge"; // guideline | process
  }
  ```
  No plural conversion needed at any boundary.

- **Loader is sync-call-safe** — called once per `runDoctorCiteCoverage` invocation, total <5ms for typical corpora. Cache outside the function if doctor enters a per-event hot loop (not currently the case).

- **Personal-layer parity** — the same loader yields KP-* entries identically; TASK-08's `--layer` filter cross-tab logic does NOT need to call a different loader for personal entries.

- **Hook-side counterpart (`readKnowledgeTypeMap` in `cite-contract-reminder.cjs`)** is a separate codepath because hooks run without node_modules access. If the on-disk meta shape changes (e.g. `description.knowledge_type` moves), update BOTH loaders in lockstep — see TASK-05 summary's "Notes for next tasks" line about this drift risk. The TASK-12 CHANGELOG should call this out.

- **No new failure mode introduced** — every fs read in the loader path is wrapped in try/catch returning `undefined`; the Map construction never iterates a `null` shape. Compatible with the rc.24 "doctor never throws on degraded inputs" invariant.

## status

completed
