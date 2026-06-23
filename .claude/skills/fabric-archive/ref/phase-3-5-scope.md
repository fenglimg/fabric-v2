# Phase 3.5 — Scope Decision + relevance_paths Derivation (ref)

> **Loaded on demand.** SKILL.md hot path retains the scope decision pseudocode, personal-layer-forces-broad rule, and brief examples. This file holds the rc.37 multi-signal derivation algorithm (edit_paths + read_paths + user_mentioned_paths), Steps 1-6 + worked generalization example + inline-edit re-derivation rules + the frontmatter `evidence_paths` upgrade.

## relevance_paths derivation algorithm (rc.37 multi-signal — NEW-7)

rc.37 NEW-7 widens Step 1 from the rc.5 single-signal (`edit_paths` only) to three sources:

1. **`edit_paths`** — files modified by `Edit` / `Write` / `MultiEdit` tool calls. The primary activation signal: if the agent CHANGED a file, the knowledge derived in this session most likely applies there.
2. **`read_paths`** — files inspected via `Read` / `Grep` / `Glob` without modification. Secondary signal: read-only inspection often anchors the applicability surface even when no write happened (e.g. discovering that a pitfall surfaces in a getter that the agent only READ).
3. **`user_mentioned_paths`** — paths the user typed verbatim in messages (`packages/server/src/foo.ts`, `\`packages/cli/**/*.ts\`` etc.). Strongest signal of all: an explicit user-named path is ground-truth applicability surface, independent of what the agent did.

```
Step 1: COLLECT (rc.37 NEW-7 — three sources)
  edit_paths = []
  read_paths = []
  user_mentioned_paths = []

  // 1a — edit signal (rc.5 primary)
  Scan session transcript for tool_use entries where
    tool_use.name ∈ {Edit, Write, MultiEdit}
  Extract the file_path argument from each, push into edit_paths.

  // 1b — read signal (rc.37 NEW-7 secondary)
  Scan session transcript for tool_use entries where
    tool_use.name ∈ {Read, Grep, Glob}
  Extract the file_path / path / glob argument from each, push into read_paths.

  // 1c — user-mentioned signal (rc.37 NEW-7 ground truth)
  Scan user messages for token sequences matching workspace-relative
  path patterns: `<segment>/<segment>/...<ext>` or `<segment>/**` or
  ``<path>`` (backtick-quoted). De-dupe and push into user_mentioned_paths.

Step 2: DEDUPE + CLASSIFY
  // Union all three sources for the relevance_paths candidate set.
  candidate_paths = unique(edit_paths ∪ user_mentioned_paths)
  // read_paths stay separate — they become evidence_paths (Step 6) rather
  // than activation triggers. A path that appears in BOTH edit_paths and
  // read_paths goes to candidate_paths (writes dominate reads).
  evidence_candidate_paths = unique(read_paths \ edit_paths)

Step 3: BLACKLIST FILTER (applies to BOTH candidate sets)
  Drop paths matching any of:
    - **/*.<ext>          where <ext> is a single trivial extension on a single file
                          (i.e. avoid emitting bare **/*.md as a relevance pattern)
    - Repo-root single files: README.md, package.json, package-lock.json,
      pnpm-lock.yaml, tsconfig.json, .gitignore, LICENSE, CHANGELOG.md

Step 4: PUBLIC-PREFIX GENERALIZE (depth ≤ 2, minGroupSize = 2)
  Group remaining candidate_paths by common prefix.
  For each group of ≥ 2 sibling paths sharing a prefix:
    - Compute longest common directory prefix
    - Limit generalization depth: at most 2 levels below the common prefix
    - Emit glob: <common-prefix>/**/*.<ext>  (or <common-prefix>/**/<filename>)
  Singleton paths (group size = 1) are kept as-is (literal path, no glob).
  (Evidence paths are NOT generalized — they stay literal so plan-context
  retrieval can do exact-match recall lookups.)

Step 5: SCOPE GATE
  IF relevance_scope == broad → relevance_paths = []  (force empty regardless of candidate_paths)
  IF relevance_scope == narrow → relevance_paths = result of Step 4

Step 6: ATTACH evidence_paths to FRONTMATTER (rc.37 NEW-7 upgrade)
  Pass evidence_candidate_paths (from Step 2, post-blacklist Step 3) to
  fab_propose as the `evidence_paths` input field. Server writes
  them to frontmatter `evidence_paths: [...]` (NOT to body `## Evidence`).
  This makes evidence consumable by plan-context retrieval as structured
  data instead of forcing markdown re-parsing every recall. The legacy
  body `## Evidence` block stays for back-compat readers but is no longer
  the source of truth.
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
