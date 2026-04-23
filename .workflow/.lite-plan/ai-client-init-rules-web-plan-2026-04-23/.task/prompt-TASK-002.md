## Goal
Evaluate web-tree-sitter WASM integration feasibility for CLI package before implementing forensic AST upgrade (REC-2).

## Task: Evaluate web-tree-sitter WASM integration feasibility

**Scope**: `packages/cli` | **Action**: Implement

### Files
- **packages/cli/package.json** → `dependencies section`: Add web-tree-sitter dependency (evaluate version compatibility with existing Node.js target)
- **packages/cli/src/scanner/tree-sitter-probe.ts** → `new probe file`: Create minimal probe that loads web-tree-sitter and parses a trivial JS file; confirm WASM loads correctly in CLI Node.js context

### Why this approach
Gated evaluation step before full implementation prevents wasted LOC if WASM integration is blocked.
Key factors: 3.5MB WASM is non-trivial for CLI startup, Grammar compatibility varies by version.
Tradeoffs: Adds one task step but eliminates risk of discovering blockers mid-implementation.

### How to do it
Evaluate and validate web-tree-sitter WASM integration in the CLI package. Assess bundle size impact (~3.5MB WASM), Node.js runtime compatibility, WASM loading strategy (lazy vs eager), and grammar availability for JavaScript/TypeScript. Produce a brief technical decision confirming the approach or identifying blockers.

1. Add web-tree-sitter to packages/cli/package.json and install
2. Create minimal probe script that loads WASM and parses a trivial JS snippet
3. Test probe against Node.js version used by CLI (check engines field in package.json)
4. Evaluate lazy loading strategy: load WASM only when inferPatternHint() is called
5. Confirm tree-sitter-javascript grammar binary is available or can be loaded from npm
6. Document decision: bundle size impact, loading latency, and integration approach

### Reference
- Pattern: CLI scanner pattern in packages/cli/src/scanner/
- Files: packages/cli/src/scanner/forensic.ts, packages/cli/package.json
- Notes: Lazy import at call site to avoid startup overhead

### Risk mitigations
- WASM loading fails in specific Node.js version → **Test against exact Node.js version in package.json engines field**
- 3.5MB WASM causes unacceptable CLI startup regression → **Use lazy loading — only load WASM when scanner is explicitly invoked**

### Done when
- [ ] web-tree-sitter installs without peer dependency conflicts
- [ ] WASM loads successfully in CLI's Node.js runtime (no native module errors)
- [ ] tree-sitter-javascript grammar parses a 10-line TypeScript/JS file to AST without errors
- [ ] Bundle size impact documented (expected ~3.5MB WASM, acceptable for CLI package)
- [ ] Decision on lazy vs eager loading documented

**Success metrics**: Probe executes in under 2 seconds in Node.js CLI context, Zero native module compilation errors

Complete each item in the "Done when" checklist.
