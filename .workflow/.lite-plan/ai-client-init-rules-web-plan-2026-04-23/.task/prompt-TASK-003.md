## Goal
Implement REC-2: Replace text pattern matching with tree-sitter AST scanning in forensic.ts and extend detector.ts.

## Previous Work
- TASK-002 completed: web-tree-sitter WASM validated (18ms load, zero errors). Probe at `packages/cli/src/scanner/tree-sitter-probe.ts` demonstrates lazy WASM loading with module-level singleton pattern. JS grammar works; TS-only syntax needs separate tree-sitter-typescript grammar.
- Resume from TASK-002 session for continuity.

## Task: REC-2 — Replace text matching with tree-sitter AST in forensic.ts + extend detector.ts

**Scope**: `packages/cli/src/scanner/forensic.ts + packages/cli/src/scanner/detector.ts` | **Action**: Implement

### Files
- **packages/cli/src/scanner/forensic.ts** → `inferPatternHint() function and PatternHintResult type`: Replace text regex matching with AST import node traversal via web-tree-sitter. Upgrade confidence algorithm: >3 import statements from framework package = HIGH, 1-3 = MEDIUM, keyword-only = LOW. Set ast_level: true when AST parsing succeeded. Add optional git churn weighting.
- **packages/cli/src/scanner/detector.ts** → `detectFramework() and exports`: Extend detectFramework() return type to structured TechProfile: `{ framework: string; version?: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; ast_evidence: string[]; co_packages: string[] }`. This is re-exported from @fenglimg/fabric-shared/node.

### Why this approach
AST import traversal is structurally precise — no false positives from comments or strings that text regex produces.
Key factors: web-tree-sitter already validated in TASK-002, PatternHintResult.ast_level boolean already exists in codebase.
Tradeoffs: WASM adds ~594KB to CLI package; git churn adds subprocess call overhead (acceptable for scan command, not hot path).

### How to do it
Replace inferPatternHint() text-based pattern matching with tree-sitter AST import analysis. Upgrade confidence scoring so web frameworks can reach HIGH confidence (currently capped at MEDIUM). Extend detector.ts to return structured tech profile with AST-level detection results. Add git churn weighted sampling for smarter file selection during forensic scan.

1. Reuse the lazy WASM loading pattern from tree-sitter-probe.ts (module-level singleton, dynamic import)
2. Parse candidate files with tree-sitter JavaScript grammar, extract all import declarations (ImportDeclaration nodes)
3. Build import source list, cross-reference against EXPECTED_CONFIG_FILES_BY_FRAMEWORK registry
4. Implement confidence scoring: count import occurrences + config file presence + package.json deps → HIGH/MEDIUM/LOW threshold
5. Update PatternHintResult to set ast_level: true when AST parsed, retain text fallback when WASM unavailable
6. Add git churn helper: run `git log --follow --oneline -20 <file>` per candidate, weight selection by recency
7. Extend detector.ts TechProfile type and update detectFramework() return shape
8. Update callers of detectFramework() to handle new structured return

### Code skeleton
**Function**: `loadTreeSitter(): Promise<Parser>` — Module-level singleton that loads WASM once, returns cached parser
**Function**: `extractImports(src: string, lang: Language): string[]` — Parse source with tree-sitter, walk ImportDeclaration nodes
**Function**: `scoreConfidence(imports: string[], framework: string): 'HIGH' | 'MEDIUM' | 'LOW'` — Count framework imports and threshold

### Reference
- Pattern: Lazy WASM loading singleton, text fallback pattern
- Files: packages/cli/src/scanner/forensic.ts, packages/cli/src/scanner/tree-sitter-probe.ts
- Notes: PatternHintResult.ast_level boolean already exists — set it true when AST path taken

### Risk mitigations
- tree-sitter grammar parses TSX differently from TS → **Test ImportDeclaration extraction against both .ts and .tsx sample files**
- git churn subprocess calls fail in projects without git history → **Wrap git command in try/catch; return neutral weight if git unavailable**

### Done when
- [ ] A React TypeScript file with 5+ React imports returns confidence=HIGH (previously MEDIUM)
- [ ] PatternHintResult.ast_level is true when tree-sitter parsed the file
- [ ] Text-based fallback still functions when WASM unavailable (ast_level=false, confidence capped at MEDIUM)
- [ ] detectFramework() returns structured TechProfile with at minimum { framework, confidence, ast_evidence }
- [ ] git churn weighting adjusts file selection order (top-churned files sampled first)
- [ ] Existing forensic scan CLI output shape unchanged (PatternHintResult fields all present)

**Success metrics**: Web framework confidence reaches HIGH for projects with >3 framework import files, Scan command completes within 5 seconds on a 500-file project, Zero regressions in existing forensic report shape

### Data Flow
Source files + WASM grammar → tree-sitter parse → import extraction → confidence scoring → PatternHintResult with ast_level=true + TechProfile

Complete each item in the "Done when" checklist.
