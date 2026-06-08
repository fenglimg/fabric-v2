# Fabric Quickstart (5 min)

> New to Fabric? Read this once and you have the mental model. No need to
> open `AGENTS.md` (that's an AI-policy file, not an onboarding guide).

## What Fabric is

A **cross-client knowledge layer** for AI coding agents (Claude Code,
Codex CLI, Cursor). Decisions / pitfalls / guidelines / models / processes
your team accumulates get stored as markdown under `.fabric/knowledge/`,
and **hook scripts surface the relevant ones** to your AI mid-session so
it stops re-arguing every architecture decision from scratch.

## What you (the developer) do — and don't do

| You DO | You DON'T |
| --- | --- |
| Run `fabric install` once per repo | Hand-edit `.fabric/agents.meta.json` |
| Run `fabric doctor` when something feels off | Hand-edit hook scripts under `.claude/hooks/` |
| Author markdown under `.fabric/knowledge/<type>/` | Worry about `Phase 0.4 / E3 / cite policy` (those are AI-side concepts) |
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
  │                      (hooks fire  entry; goes      fabric-     │
  │                      on session   to               review     │
  │                      start +      .fabric/         skill      │
  │                      every Edit)  knowledge/                  │
  │                                   pending/                    │
  │                                                                │
  │                                                                │
  │   ↻ knowledge maintenance: use `fabric doctor --fix-knowledge` │
  │     for deterministic demote / archive / default backfill       │
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
# .fabric/knowledge/pending/pitfalls/KT-PIT-0001--atlas-premultiplyalpha.md
id: KT-PIT-0001
knowledge_type: pitfalls
maturity: draft
description:
  summary: Atlas premultiplyAlpha flag must match between texture-packer and runtime loader; mismatch shows as black edges on transparent sprites.
relevance_paths: ["src/render/**", "assets/atlas/**"]
```

You review it (`/fabric-review` slash command; deterministic knowledge
maintenance uses `fabric doctor --fix-knowledge`),
promote it, and now every PreToolUse Edit on `src/render/*` surfaces this
pitfall in-context. The next contributor never sees the black edges.

## First 30 minutes — troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `fabric doctor` shows a JSON dump | Outdated global CLI (rc.30 against rc.31+ project schema) | `npm install -g @fenglimg/fabric-cli@latest` + re-run `fabric install` |
| AI ignores hint output like `KT-PIT-0001 · KT-PIT-0001` | Opaque summaries (description.summary == stable_id) | Run `/fabric-review` skill OR wait for the rc.35 hint-renderer fallback to extract `## Summary` automatically |
| `fabric-archive` skill never fires | Hooks not wired in `.claude/settings.json` | `fabric install` re-injects hooks idempotently |
| AI never writes `KB:` cite lines | Cite policy text not in your AGENTS.md managed block | `fabric install` re-syncs the cite policy block |
| SKILL.md feels too long to read | It is — designed as a phase navigator, not a manual | Skim Hard Rules + the phase you're currently in; ref files have details |

## Further reading

- `docs/getting-started.md` — install / verify / re-init in depth
- `docs/initialization.md` — what `fabric install` actually does
- `docs/UPGRADE.md` — rc.30 → rc.35 breaking-change checklist
- `AGENTS.md` — **AI policy file** (for AI assistants, not onboarding)
