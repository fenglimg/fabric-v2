# Three surfaces — CLI, Skill, MCP

Fabric exposes its functionality across three surfaces. Each one fits a
different moment in your day: a terminal session with no AI in the loop, an
AI conversation that needs LLM judgment over content, or a primitive
write/query that both of the above call into.

This doc is the source of truth for which surface to use when. README and
each SKILL.md cross-reference back here.

## The decision rule

> **Does this action need no AI in the loop? → CLI. Needs LLM judgment on
> conversation or code? → Skill. Primitive write or query underlying both?
> → MCP.**

That one-liner answers ~95% of cases. The table below makes the remaining
edges concrete; the FAQ at the bottom handles the ambiguous ones.

## The three surfaces

| Surface              | When                                                 | Trigger                  | Examples                                                                       |
| -------------------- | ---------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| CLI `fabric <cmd>`   | Terminal, no AI in loop, deterministic               | User types               | `install`, `scan`, `hooks install`, `doctor`, `plan-context-hint`                 |
| Skill `/fabric-<name>` | In AI convo, needs LLM judgment on context         | AI client loads SKILL.md | `fabric-archive`, `fabric-review`, `fabric-import`                             |
| MCP `fab_<name>`     | Skill+Agent primitives (write / query underneath)    | tool_use                 | `fab_extract_knowledge`, `fab_review`, `fab_plan_context`, `fab_get_knowledge_sections` |

Each column maps to one mental model:

- **CLI** is a script. It opens files, mutates state, prints results, exits.
  Nothing in its execution depends on an LLM being available. It is what
  you reach for in a shell, a CI job, a `Makefile`, or a post-commit hook.
- **Skill** is a prose template (`SKILL.md`) that an AI client loads into
  its prompt when triggered. It encodes the *judgment* — "is this session
  worth archiving?", "which pending entries are duplicates?" — that a
  deterministic CLI cannot reasonably make. Skills call MCP tools to do
  their writes.
- **MCP** is the primitive layer. Four tools (`fab_plan_context`,
  `fab_get_knowledge_sections`, `fab_extract_knowledge`, `fab_review`)
  expose the underlying knowledge operations. Both Skills and standalone
  agent reasoning call them; the CLI also imports the same code paths
  directly (see `fabric plan-context-hint` → `planContext()`).

## Three concrete flows

### Flow A — Fresh repo install (CLI)

You just cloned a repo and want Fabric wired in. There is no AI in the
loop yet; this is pure deterministic IO.

```bash
$ cd my-repo
$ pnpm dlx @fenglimg/fabric-cli install
```

`fabric install` scans the repo, installs Skills + Stop/SessionStart/PreToolUse
hooks for each detected client, writes the `.fabric/` tree, and produces 4–7
seed knowledge entries. No LLM is consulted. The output is reproducible
given the same input tree.

Why CLI not Skill: this is the **bootstrap paradox**. The Skill files
don't exist on disk until `fabric install` puts them there. The AI client
can't load a Skill it doesn't have yet. Skills assume Fabric is already
installed; CLI is what installs Fabric.

### Flow B — Work-day archive (Skill)

You finished a debugging session in Claude Code. The Stop hook
(`fabric-hint.cjs`) fires, sees ≥5 `plan_context` calls since the last
archive, and emits a `recommended_skill: "fabric-archive"` JSON pointer.
The client surfaces this to the AI, which invokes `/fabric-archive`.

The Skill then:

1. Reads `events.jsonl` and session digests to find candidate insights.
2. Phase 0.5 viability gate — judges whether any insight is archive-worthy
   (not just "session ended").
3. Classifies each candidate into one of five knowledge types
   (decision / pitfall / guideline / model / process).
4. Computes `relevance_paths` from the session's `Edit/Write/MultiEdit`
   targets via public-prefix generalization.
5. Calls `fab_extract_knowledge` (MCP) to persist each accepted candidate
   into `pending/`.

Why Skill not CLI: every step from 1–4 is a judgment call. "Is this
worth keeping?", "Is this a decision or a pitfall?", "How narrow should
the path glob be?" — no deterministic rule produces correct answers; you
need the LLM that just lived through the session to read its own context.
A CLI would have to hard-code thresholds and would mis-archive constantly.

### Flow C — Agent runtime knowledge fetch (MCP)

Mid-session, your AI agent realizes it's about to edit `auth/oauth.ts` and
should check if there are relevant pitfalls or decisions. It calls
`fab_plan_context` directly via MCP:

```json
{
  "current_task": "fix OAuth refresh-token rotation bug",
  "paths": ["packages/auth/oauth.ts"]
}
```

The MCP server returns a candidate index. If ≤30 entries, content is
inlined. If >30, the agent makes a follow-up call to
`fab_get_knowledge_sections` with a `selection_token` for targeted fetch.
Each fetched entry emits a `knowledge_consumed` event so decay lints know
what's actually being used.

Why MCP not Skill: this is a primitive call, not a judgment task. The
agent already knows what it wants (knowledge relevant to a path); it just
needs the underlying query. Wrapping this in a Skill would add prose
overhead for no judgment gain. MCP tools are exactly the right grain.

## Why the boundary matters for feature design

Surface choice isn't just documentation — it shapes how features are
implemented:

- **CLI features must work without an LLM in scope.** That's why
  `fabric install` includes a deterministic `runInitScan` that produces 4–7
  seed entries from forensic scanning, instead of waiting for an AI to
  populate them. The Skill (`fabric-import`) then enriches from `git log`
  *after* the CLI has bootstrapped enough state for the AI client to even
  load.
- **Skills earn the LLM cost only for judgment.** `fabric-archive` does
  not enforce a hard "≥3 edits = archive" rule; the Stop hook nudges, but
  the Skill makes the final viability call. Conversely, the Skill does
  not re-implement file IO — it shells out to `fab_extract_knowledge`
  (MCP) which knows how to write atomically, dedupe by hash, and emit
  the right ledger event.
- **MCP tools are the only place where new write paths land.** If you
  want a new Skill, you write `SKILL.md` + (if needed) a new MCP tool. If
  you want a new CLI command, you import the same MCP-tool-backing
  service. There is no "Skill that writes directly to disk without going
  through MCP" — that's how knowledge-event invariants stay intact across
  clients.

## FAQ

### Why is `fabric install` a CLI command and not a Skill?

Bootstrap paradox (covered above). Three additional reasons:

1. **Deterministic IO.** `init` writes a fixed scaffold given an input
   tree. No judgment is needed.
2. **No client coupling.** CI, `Makefile`, post-clone scripts, and CLI-only
   users all need `init`. A Skill would lock it to AI clients only.
3. **Idempotency.** `fabric install --reapply` is a well-defined operation;
   a Skill-driven re-init would have to re-derive intent every time.

### Why is `fabric-archive` a Skill and not a CLI subcommand?

It needs LLM judgment over conversation content that lives in the AI
client's context window, not on disk. A CLI can read `events.jsonl` and
session digests, but it can't read "the user just realized OAuth refresh
breaks on clock skew" — that knowledge is in the chat transcript, and
only the AI in that transcript can extract it.

### Why is `fab_plan_context` an MCP tool *and* a CLI subcommand
(`fabric plan-context-hint`)?

Different callers need different transports. The MCP tool serves the
agent during a session. The CLI subcommand serves hook scripts that run
in client subprocesses with no `node_modules`, no MCP client, and only
stdout JSON as the contract. Both import `planContext()` directly — the
*function* is the engine, MCP and CLI are adapters. See README "MCP vs
CLI — adapters, not redundancy" for the full rationale.

### Can a Skill write to disk without going through MCP?

No. Skills are prose templates; their `allowed-tools` frontmatter
restricts them to `Read / Glob / Grep / Bash / Edit / mcp__fabric__*`. Any
knowledge mutation goes through `fab_extract_knowledge` or `fab_review`
so the ledger, hash dedup, and layer-flip checks fire consistently
regardless of which Skill (or which client) initiated the write.

### What about hooks — are they a fourth surface?

Hooks are wiring, not a user-facing surface. `fabric-hint.cjs` (Stop),
`knowledge-hint-broad.cjs` (SessionStart), `knowledge-hint-narrow.cjs`
(PreToolUse) are deterministic JSON emitters that nudge the AI to load
the right Skill at the right time. They run in subprocesses,
short-circuit on cooldowns, and never call MCP themselves. Treat them as
"things `fabric install` installs", not as a surface you reason about
directly.

## Cross-references

- README → "Three surfaces" section (compact summary linking here).
- `packages/cli/templates/skills/fabric-archive/SKILL.md` → top
  blockquote: "Surface: Skill. See docs/surfaces.md."
- `packages/cli/templates/skills/fabric-review/SKILL.md` → same.
- `packages/cli/templates/skills/fabric-import/SKILL.md` → same.
- `fabric install` stdout footer → "More: docs/surfaces.md explains when to
  use CLI vs Skill vs MCP".
