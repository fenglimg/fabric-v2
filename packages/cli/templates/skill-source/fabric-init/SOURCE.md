# fabric-init — Canonical Skill Source

> This file is the single source of truth for the fabric-init skill.
> Do NOT edit the per-client SKILL.md files directly.
> Run `packages/cli/scripts/derive-skills.ts` to regenerate them from this source.

## Precondition

MUST: Read `.fabric/forensic.json` before taking any other action. If the file does not
exist, stop immediately and tell the user: run `fab init` first to generate the evidence
package.

MUST: Check `.fabric/init-context.json`. If it already exists, stop and report that this
repository appears to have completed initialization already.

MUST: Treat `.fabric/bootstrap/README.md` as the authoritative initialization guide for
the current repository.

MUST: Use `.fabric/forensic.json` and repository structure as evidence when deciding what
to do next.

MUST: Preserve protected tokens exactly as written — see the Protected Tokens section.

NEVER: Claim initialization is complete without having checked `.fabric/init-context.json`.

NEVER: Rewrite or translate protected tokens.

NEVER: Ignore `.fabric/bootstrap/README.md` when determining the next initialization step.

Treat the following state as initialization pending:

- `.fabric/forensic.json` exists
- `.fabric/init-context.json` does not exist

## Execution Flow — 3 Phases / 3 Rounds

### Phase 1 — Framework Confirmation (1 round, efficient)

Display a summary of `framework`, `topology.by_ext`, and `entry_points` from
`.fabric/forensic.json`. Ask the user 1–2 clarifying questions about the framework
architecture.

Example (Cocos Creator 3.x):

> I detected a Cocos Creator 3.8 project. Main scripts are in `assets/scripts` using the
> `@ccclass + extends Component` pattern. Please confirm: (1) Is this a TypeScript project
> (not JavaScript)? (2) Are node references injected mainly via `@property(Node)`, or via
> `find/getChildByName`?

Store the user's answers as verified framework assumptions before proceeding to Phase 2.

### Phase 2 — Invariant Extraction (1 round, critical)

Based on the `recommendations_for_skill` list in `.fabric/forensic.json`, ask the user
3–5 invariant questions covering three categories:

- `ban`: things that must never appear — e.g. `any`, `async` in `update()`, find-by-name
- `require`: things that must always be present — e.g. strict TypeScript, `@ccclass`
  decorator, imports only from `cc`
- `protect`: directories or files that AI must not modify — typically
  `assets/prefabs/**`, `assets/scenes/**`, `**/*.meta`

Principles:

- Ask only about invariants, not about preferences.
- Each question accepts only yes / no / a concrete rule — never accept vague answers.
- Do not auto-infer hard constraints the user has not confirmed.

### Phase 3 — Construction and Landing (1 round, automated)

#### 3.1 Write `.fabric/init-context.json`

Fields required:

- `framework`
- `architecture_patterns`
- `invariants`
- `domain_groups`
- `interview_trail`
- `forensic_ref`

Writing rules:

- `invariants[].type` MUST be one of `ban`, `require`, `protect`.
- `domain_groups` is inferred from `entry_points` and interview results.
- `interview_trail[]` MUST record the raw Q&A from Phase 1 and Phase 2.
- `forensic_ref` MUST be `.fabric/forensic.json`.

#### 3.2 Generate layered `AGENTS.md`

Root `AGENTS.md` requirements:

- MUST be within 300 lines.
- Structure:
  - `# {projectName} — L0 AGENTS.md`
  - `<!-- fab:index -->`: populated with the `domain_groups` index
  - `## L0 AI Constraints`: derived from invariants, grouped by `ban`, `require`, `protect`
  - `## @HUMAN`: protect paths and any human-declared protection rules
  - `## L1 Candidate Notes`: candidate sub-module descriptions for each domain group

If `domain_groups.length >= 2`, generate a `{group_path}/AGENTS.md` for each group.
Maximum depth is L3; total nesting MUST NOT exceed 4 levels.

#### 3.3 Update `.fabric/agents.meta.json`

- The `nodes` tree MUST match the generated AGENTS hierarchy.
- Update the hash of every AGENTS.md file that was written.
- Maintain a consistent internal revision hash chain.

#### 3.4 Final output

List all generated files for the user and recommend running `fabric doctor --fix` for
ongoing maintenance.

## Hard Rules

- Zero TODO: never generate `TODO`, `TBD`, placeholders, or stubs in output files.
- No YAML frontmatter in outputs: generated `AGENTS.md` files MUST NOT contain YAML
  frontmatter.
- Root `AGENTS.md` MUST be <= 300 lines.
- Total AGENTS nesting MUST be <= 4 levels.
- Do not auto-infer invariants the user has not confirmed.
- When content is uncertain, omit it — do not leave placeholders.

## Output Contract

On successful completion the following files exist or are updated:

| File | Action |
|------|--------|
| `.fabric/init-context.json` | Created with all required fields |
| `AGENTS.md` | Created (root L0) |
| `{group_path}/AGENTS.md` | Created for each domain group (when applicable) |
| `.fabric/agents.meta.json` | Updated nodes tree + hashes |

On failure or early termination the skill MUST leave no partial files. If a write fails
mid-sequence, report the failure and the exact file that was not written.

## Protected Tokens

The following tokens MUST be preserved exactly as shown — same casing, same punctuation,
never translated:

| Token | Type |
|-------|------|
| `AGENTS.md` | Filename |
| `FABRIC.md` | Filename |
| `.fabric/agents.meta.json` | Path |
| `.fabric/init-context.json` | Path |
| `.fabric/forensic.json` | Path |
| `.fabric/bootstrap/README.md` | Path |
| `MUST` | Keyword |
| `NEVER` | Keyword |
| `fab init` | CLI command |
| `fabric doctor --fix` | CLI command |
| `<!-- fab:index -->` | HTML comment marker |
| `@HUMAN` | Section marker |
