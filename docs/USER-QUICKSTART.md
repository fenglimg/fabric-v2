# Fabric Quickstart (5 min)

> New to Fabric? Read this once and you have the mental model. No need to
> open `AGENTS.md` (that's an AI-policy file, not an onboarding guide).

## What Fabric is

A **cross-client knowledge layer** for AI coding agents (Claude Code,
Codex CLI). Decisions / pitfalls / guidelines / models / processes
your team accumulates get stored as markdown in mounted stores under
`~/.fabric/stores/`, and **hook scripts surface the relevant ones** to your AI
mid-session so it stops re-arguing every architecture decision from scratch.


## Evidence vs knowledge (positioning)

Fabric is a **curated knowledge sustainment** layer — decisions, pitfalls,
guidelines, models, and processes that survive review. It is **not**:

- a terminal / AI-session **evidence** capture tool (that class of product
  keeps raw command output and transcripts for search-and-zoom);
- a multi-agent **orchestrator** (workflow runners stay separate).

| Layer | Role | Examples |
| --- | --- | --- |
| Evidence | What just happened | Terminal failures, test logs, session transcripts |
| **Knowledge (Fabric)** | What the team should remember | Reviewed decisions / pitfalls / guidelines |
| Orchestration | How agents coordinate work | External workflow tools |

**Allowed pipeline (one-way):**

```text
local evidence (optional companion) → human/skill extract → fab_propose pending → fabric-review → canonical store
```

**Forbidden:**

- auto-promoting raw logs / captures into **canonical** knowledge without review;
- installing shell capture hooks as part of Fabric `install`;
- treating pending draft sets as a second knowledge store.

When an agent needs "what did the last test print?", retrieve **evidence**
first (or ask the user); when it needs "why did we choose X?", use Fabric
recall (`fab_recall` / SessionStart / PreToolUse). The optional
`fabric-recall-playbook` skill packages that protocol for agents.

## What you (the developer) do — and don't do

| You DO | You DON'T |
| --- | --- |
| Run `fabric install` once per repo | Hand-edit Fabric-managed hook/bootstrap artifacts |
| Run `fabric doctor` when something feels off | Hand-edit hook scripts under `.claude/hooks/` |
| Use `fabric store bind` / `fabric store switch-write --scope` and the Fabric Skills to manage knowledge | Hand-write project-local `.fabric/knowledge/<type>/` roots |
| `npm install -g @fenglimg/fabric-cli@latest` to upgrade | Memorise the 35 doctor lint codes |

## The 4-step flow

```text
  ┌────────────────────────────────────────────────────────────────┐
  │                                                                │
  │   install            run            edit                       │
  │   ───────            ───            ────                       │
  │                                                                │
  │  fabric install   →  AI works  →  AI proposes  →  you review   │
  │  (once per repo)     normally     a knowledge      via the     │
  │  + bind store        (hooks fire  entry; goes      fabric-     │
  │  + write route       on session   to routed        review     │
  │                      start +      store's          skill      │
  │                      every Edit)  knowledge/                  │
  │                                   pending/                    │
  │                                                                │
  │                                                                │
  │   ↻ knowledge maintenance: use `fabric doctor --fix` │
  │     for store counters, pending defaults, and cache cleanup      │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘
```

## A real example: when does a pitfall get captured?

Last quarter you spent an afternoon chasing a black-edge on transparent
sprites in a Cocos2d project. Root cause: the `atlas.premultiplyAlpha`
flag was inverted between the texture-packer output and the runtime
loader. You fix it, commit, and move on.

Without Fabric: 3 months later, a new contributor hits the same bug.

With Fabric: at the end of your session the AI sees a `wrong-turn-and-revert`
signal in the conversation, calls the `fabric-archive` skill, and proposes
a pending pitfall entry:

```yaml
# <routed-store>/knowledge/pending/pitfalls/KT-PIT-0001--atlas-premultiplyalpha.md
id: KT-PIT-0001
knowledge_type: pitfalls
maturity: draft
description:
  summary: Atlas premultiplyAlpha flag must match between texture-packer and runtime loader; mismatch shows as black edges on transparent sprites.
relevance_paths: ["src/render/**", "assets/atlas/**"]
```

You review it (`/fabric-review` slash command; deterministic store-backed
maintenance uses `fabric doctor --fix`),
promote it, and now every PreToolUse Edit on `src/render/*` surfaces this
pitfall in-context. The next contributor never sees the black edges.

For one team store, install/onboarding writes the project route for you. For
multiple shared stores, use `fabric store switch-write <alias> --scope <semantic_scope>`
so Fabric knows where a scope such as `project:fabric-v2` should write.

## First 30 minutes — troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `fabric doctor` shows a JSON dump | Outdated global CLI (rc.30 against rc.31+ project schema) | `npm install -g @fenglimg/fabric-cli@latest` + re-run `fabric install` |
| AI ignores hint output like `KT-PIT-0001 · KT-PIT-0001` | Opaque summaries (description.summary == stable_id) | Run `/fabric-review` skill OR wait for the rc.35 hint-renderer fallback to extract `## Summary` automatically |
| `fabric-archive` skill never fires | Hooks not wired in `.claude/settings.json` | `fabric install` re-injects hooks idempotently |
| AI never writes `KB:` cite lines | Cite policy text not in your AGENTS.md managed block | `fabric install` re-syncs the cite policy block |
| SKILL.md feels too long to read | It is — designed as a phase navigator, not a manual | Skim Hard Rules + the phase you're currently in; ref files have details |

## Further reading

- `docs/ARCHITECTURE.md` — current package / surface / install pipeline map
- `docs/RUNTIME-CONTRACTS.md` — CLI, MCP, schema and config contract entry
- `docs/TESTING.md` — test strategy and drift gates
- `docs/UPGRADE.md` — supported upgrade notes
- `AGENTS.md` — **AI policy file** (for AI assistants, not onboarding)
