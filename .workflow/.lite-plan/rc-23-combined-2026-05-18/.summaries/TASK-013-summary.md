# TASK-013: F8b — remove sections enum + KNOWLEDGE_SECTION_NAMES_TUPLE + unify to B-set heading

## Changes

- `packages/shared/src/schemas/api-contracts.ts`: **deleted** `KNOWLEDGE_SECTION_NAMES_TUPLE` const; removed `sections` field from `knowledgeSectionsInputSchema`; `knowledgeSectionsOutputSchema.rules[].sections: Record<string,string>` → `body: z.string()`; collapsed `diagnostics` discriminatedUnion to a plain object schema with only `missing_knowledge_metadata` (the `missing_section` branch retired).
- `packages/server/src/services/knowledge-sections.ts`: removed `KNOWLEDGE_SECTION_NAMES` / `KnowledgeSectionName` exports; removed `missing_section` diagnostic + per-section response shape; replaced `parseKnowledgeSections` (54-line A-set tokenizer) with `extractBody` (10-line frontmatter stripper using the same regex pattern from knowledge-meta-builder.ts); rewrote rule loop to call `extractBody(content)` and return `rules[].body: string`; `requested_sections` in `knowledge_sections_fetched` event now always emitted as `[]` (the field stays in the ledger envelope for replay continuity).
- `packages/server/src/services/knowledge-meta-builder.ts`: `extractRuleSections` regex relaxed from `/^(?:#{2,6})\s+\[([A-Z_]+)\]\s*$/gmu` to `/^#{2,6}\s+(.+?)\s*$/gmu` to capture B-set plain `## <Title>` headings (Summary / Why proposed / Session context / Evidence). Field still emitted into `agents.meta.json` `nodes[].sections` as forensic metadata.
- `packages/server/src/tools/knowledge-sections.ts`: description string rewritten — dropped the 4-section enum explanation; now reads "Fetch the full markdown body of one or more Fabric rules picked from fab_plan_context. Returns body strings keyed by stable_id (frontmatter stripped). Use after fab_plan_context returned selectable entries to load full rule content for LLM context injection."
- `packages/shared/src/templates/bootstrap-canonical.ts` + `.fabric/AGENTS.md`: T1+T8 ripple — three call-site examples (`fab_get_knowledge_sections({ selection_token, ai_selected_stable_ids: [...], sections: [...] })`) all simplified to remove the `sections:` parameter.

## Tests modified

- `packages/server/src/services/knowledge-sections.test.ts`: removed all 10 `sections: ["MANDATORY_INJECTION"]` input args; replaced `parseKnowledgeSections` describe block with new `extractBody` tests (frontmatter strip + BOM strip + passthrough); rewrote the main rules+diagnostics assertion from per-section `Record<string,string>` to `body: string` substring checks; removed 5 `missing_section` diagnostic expectations from the lifecycle test (3 in the global-protocol case, 2 in ui-batch-rendering); updated `knowledge_sections_fetched` ledger assertion to expect `requested_sections: []`.
- `packages/server/src/tools/knowledge-sections.test.ts`: removed the `sections` ZodArray type from the schema-shape inference + the two enum-validation expectations; added `expect(shape.sections).toBeUndefined()` to guard against regression.
- `packages/server/src/services/knowledge-meta-builder.test.ts`: fixture `## [MANDATORY_INJECTION]` → `## Summary`; assertion `sections: ["MANDATORY_INJECTION"]` → `sections: ["Summary"]`.
- `packages/shared/test/templates/bootstrap-canonical.test.ts`: replaced "enumerates the canonical KNOWLEDGE_SECTION_NAMES tuple" with two negative assertions: bootstrap must NOT contain any of the 4 retired enum names AND must NOT contain a `sections: [...]` parameter demo.
- `packages/shared/test/api-contracts.test.ts`: imported `knowledgeSectionsInputSchema`; added new `describe("knowledgeSectionsInputSchema — rc.23 F8b shape")` with two cases (no `sections` field + legacy field stripped by `z.object`); added new `describe("knowledgeSectionsOutputSchema — rc.23 F8b body shape")` with two cases (body string accepted + missing body rejected).
- `packages/server/__tests__/__snapshots__/tool-contracts.test.ts.snap`: regenerated via `pnpm test -u` — 2 snapshots updated (the two snapshot tests for `fab_get_knowledge_sections` input + output JSON schema).

## Verification

- [x] **`KNOWLEDGE_SECTION_NAMES_TUPLE` grep returns zero hits**: only one forensic comment match in api-contracts.ts (no live reference).
- [x] **`KNOWLEDGE_SECTION_NAMES` (server-side) grep**: 2 comment matches in non-test files (api-contracts.ts comment, knowledge-sections.ts comment) + 2 in bootstrap-canonical.test.ts (test-side anchor comments). Zero live named-enum references.
- [x] **A-set enum names (`MISSION_STATEMENT|MANDATORY_INJECTION|BUSINESS_LOGIC_CHUNKS|CONTEXT_INFO`) grep on non-test source files**: only forensic comments in doctor.ts (L934 historical narrative), knowledge-meta-builder.ts (rc.23 anchor comment), api-contracts.ts (rc.23 anchor comment). Zero live z.enum / named-enum references.
- [x] **`knowledgeSectionsInputSchema` no `sections` field**: typecheck (DTS build green); runtime safeParse({ ...without sections }) succeeds; legacy `sections:` key stripped silently.
- [x] **`knowledgeSectionsOutputSchema.rules[].body: string`**: schema emits body, missing body is rejected (test added).
- [x] **bootstrap + AGENTS.md no `sections:` demos**: `grep -n "sections:" .fabric/AGENTS.md packages/shared/src/templates/bootstrap-canonical.ts` returns ZERO HITS.
- [x] **tool-contracts snapshot regenerated**: 2 snapshots updated.

## Tests

- [x] `pnpm -F @fenglimg/fabric-shared test`: **351/351 pass** (25 files).
- [x] `pnpm -F @fenglimg/fabric-server test -u`: **518/519 pass | 1 skipped | 0 fail**. Snapshots regenerated (2 updated). The 1 skipped is pre-existing (unrelated to this task).
- [x] `pnpm -F @fenglimg/fabric-cli test`: **567/567 pass** (41 files) — zero spillover from shared schema change.

## Deviations

- **`requested_sections` ledger field retained, emitted as `[]`**: the `knowledgeSectionsFetchedEventSchema` in `event-ledger.ts` declares `requested_sections: z.array(z.string())` (generic, not enum-typed); replay code never reads this field (canonical signal is `final_stable_ids`). Removing the field entirely would touch the event ledger replay surface in doctor.ts cite-coverage / orphan-demote paths — kept minimal per scope discipline.
- **`extractRuleSections` retained (relaxed, not deleted)**: agents.meta.json `nodes[].sections?: string[]` field still populated with the B-set headings as forensic metadata. The schema declares it optional; downstream code (planContext description_index, knowledge-sections delivery) never consumes it. Could be removed in a follow-up if forensic value is judged zero.
- **Fixture A-set heading strings retained in test fixtures**: `## [MANDATORY_INJECTION]` strings remain in `knowledge-sections.test.ts` test fixtures (`createSectionProject` / V2 diagnostic test) + `doctor.test.ts` (many places) + `mcp-server.test.ts`. These are markdown content strings, NOT enum references — they don't affect behavior because the parser now treats them as plain headings. Task explicitly allowed: "允许 test fixture 中作为字符串保留,作为命名 enum 必须零".

## Notes

- The A-set heading discipline (`## [BRACKET]`) is now wholly retired from the writer side. F8a removed the scan baseline writers; F8b removed the reader-side enum + the API parameter that selected it. The relaxed `extractRuleSections` accepts both A-set and B-set in agents.meta.json forensic metadata so legacy `.md` files (if any survive in user projects) won't break the meta build.
- Next task should consider whether `nodes[].sections?: string[]` is still load-bearing or can be deleted in rc.24 — currently it's pure forensic metadata.
