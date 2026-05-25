# Phase 3.5 — Scope Decision + relevance_paths Derivation (ref)

> **Loaded on demand.** SKILL.md hot path retains the scope decision pseudocode, personal-layer-forces-broad rule, and brief examples. This file holds the rc.5 single-signal `edit_paths` derivation algorithm (Steps 1-6) + worked generalization example + inline-edit re-derivation rules.

## relevance_paths derivation algorithm (rc.5 single-signal: edit_paths only)

rc.5 uses ONLY the `edit_paths` signal — list of paths modified by `Edit` / `Write` / `MultiEdit` tool calls in the current session. Multi-signal (read_paths + body regex + symbols) is explicitly deferred to rc.7 per design decision.

```
Step 1: COLLECT
  edit_paths = []
  Scan session transcript for tool_use entries where
    tool_use.name ∈ {Edit, Write, MultiEdit}
  Extract the file_path argument from each, push into edit_paths.

Step 2: DEDUPE
  edit_paths = unique(edit_paths)

Step 3: BLACKLIST FILTER
  Drop paths matching any of:
    - **/*.<ext>          where <ext> is a single trivial extension on a single file
                          (i.e. avoid emitting bare **/*.md as a relevance pattern)
    - Repo-root single files: README.md, package.json, package-lock.json,
      pnpm-lock.yaml, tsconfig.json, .gitignore, LICENSE, CHANGELOG.md
    - Read-only paths (never modified) — those go to ## Evidence, not relevance_paths

Step 4: PUBLIC-PREFIX GENERALIZE (depth ≤ 2, minGroupSize = 2)
  Group remaining paths by common prefix.
  For each group of ≥ 2 sibling paths sharing a prefix:
    - Compute longest common directory prefix
    - Limit generalization depth: at most 2 levels below the common prefix
    - Emit glob: <common-prefix>/**/*.<ext>  (or <common-prefix>/**/<filename>)
  Singleton paths (group size = 1) are kept as-is (literal path, no glob).

Step 5: SCOPE GATE
  IF relevance_scope == broad → relevance_paths = []  (force empty regardless of edit_paths)
  IF relevance_scope == narrow → relevance_paths = result of Step 4

Step 6: ATTACH READ-ONLY EVIDENCE
  Read-only paths (filtered in Step 3) are emitted as a ## Evidence markdown
  block in the pending entry body — NOT in relevance_paths. They document
  what the agent consulted without making them part of the activation gate.
```

## Worked generalization example

Edit history during session:

```
packages/server/src/services/extract.ts
packages/server/src/services/review.ts
packages/server/src/services/promote.ts
packages/cli/src/commands/plan.ts
README.md
```

Step 1-2 (collect + dedupe): all 5 unique.
Step 3 (blacklist): drop `README.md` (repo-root single file).
Step 4 (generalize, depth ≤ 2, minGroupSize = 2):
- `packages/server/src/services/{extract,review,promote}.ts` → group size 3 ≥ 2, common prefix `packages/server/src/services/`, glob: `packages/server/src/services/**/*.ts`
- `packages/cli/src/commands/plan.ts` → group size 1, kept literal.

Step 5 (assume `relevance_scope=narrow`):

```json
"relevance_paths": [
  "packages/server/src/services/**/*.ts",
  "packages/cli/src/commands/plan.ts"
]
```

If `relevance_scope=broad` had been chosen instead, `relevance_paths` would be `[]` regardless of the above.

## Inline-edit support during batch review

The user MAY inline-edit `[relevance_scope=...]` in the batch review. When this happens:

- Edit changes `narrow → broad`: clear `relevance_paths` to `[]`.
- Edit changes `broad → narrow`: re-run Steps 1-4 of the derivation algorithm to recompute.
- The user MAY also directly inline-edit `relevance_paths` to a custom array; treat this as authoritative and skip auto-derivation.
