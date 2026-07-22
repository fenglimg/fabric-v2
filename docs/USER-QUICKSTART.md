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

## Archive as truth

Durable team memory is **not** chat memory. The only path into the canonical store is:

```text
local evidence / session insight → fab_propose (pending) → fabric-review / fab_review approve → canonical
```

- `pending` is required before canonical; there is no mem0-style auto-promote.
- Archive cadence is light (skill self-trigger + soft Stop nudge) — not a task engine.
- Multi-repo dogfood remains the product mainline; this narrative does not replace it.

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


## Multi-store / team clone (≤1 screen)

1. **Mount** the team store (once per machine): `fabric install --global --url <team-git-url>` or `fabric store add …`.
2. **Bind** this repo: `fabric store bind <alias>` then `fabric store switch-write <alias>` (team write target — not personal).
3. **Prove**: `fabric first-hit` — exit 0 means required stores are mounted, write target is valid, and knowledge is non-empty.
4. **If it fails**, codes mean:
   - `missing_required` — required id not mounted (clone/bind the missing store)
   - `write_target_mismatch` — `active_write_store` is wrong/unmounted/personal
   - `store_unreachable` — registry points at a missing directory (remount/re-clone)
   - `empty_store` — bound but zero knowledge (`fabric first-hit --seed` on empty local only)
5. **Doctor**: `fabric doctor` surfaces the same multi-store gaps with remediations.

Product default is **one team store per project** (max-1 team slot); personal is separate machine-wide identity.

Maturity promote/retire rules (draft → verified → proven; not usage-count): [`docs/KNOWLEDGE-MATURITY.md`](./KNOWLEDGE-MATURITY.md).

## After install — prove surface

1. **`fabric first-hit`** — bind + non-empty knowledge + hooks (or diagnose with fail-loud codes).
2. **`fabric inspect`** and/or **`fabric preview`** — read the same store surface hooks use (no second knowledge model).
3. **Optional:** `fabric audit metrics` — consumption / cite-style telemetry when you care about ops health.

Global CLI must be upgraded for new commands such as `first-hit` — see [`docs/UPGRADE.md`](./UPGRADE.md).

## MCP project root: dynamic vs pinned

`fabric install` 默认使用 dynamic 模式，让 MCP client 在每个 workspace/session
提供当前 roots，不把安装时目录固化到 machine-global config：

```bash
fabric install --mcp-root-mode dynamic
fabric install --mcp-root-mode pinned --mcp-project-root /absolute/project/path
```

`--mcp-project-root` 只能与 `--mcp-root-mode pinned` 一起使用，而且必须是绝对
路径。pinned 配置写入两个 public keys：`FABRIC_PROJECT_ROOT` 和
`FABRIC_PROJECT_ROOT_PROVENANCE`；operator CLI pin 的 marker 是 `operator:v1`，
project-owned pin 是 `project:v1`。dynamic 配置不写这两个 key；重装时已有的
explicit pin 会保留。

升级检查把旧 root pin 分成 4 种 provenance state：

| State | 判定 | 自动修复决策 |
| --- | --- | --- |
| `managed` | marker 为 `fabric-installer:v1:<sha256>`，且 digest 与 client kind、command、args、root 完全匹配 | 可移除 root 与 marker，转为 dynamic |
| `explicit` | marker 为 `operator:v1` 或 `project:v1` | 保留，不覆盖 operator/project 意图 |
| `ambiguous` | root/marker 缺一、entry 不完整或 installer digest 不匹配 | fail closed，不自动修改；人工确认来源 |
| `absent` | root 与 marker 都不存在 | 已是 dynamic，无需修改 |

任何 `managed` repair 都必须 backup-first：先以
`<config>.fabric-backup.<YYYYMMDDhhmmss>` 创建 `0600` 独占备份，校验原文和
SHA-256 后才原子写回。写入失败会恢复原文并再次验证；重复检查已是 `absent`
时不再修改。不要手工删除 `ambiguous` 或 `explicit` pin。当前 public
`fabric doctor --fix` 尚未连接这项 repair primitive，因此普通 doctor 结果不能替代
provenance 判定；升级工具接入前应保留配置备份并人工确认来源。

linked worktree 的 `workspaceRoot` 是当前工作树，但 `identityRoot` 指向 Git common
identity 对应的主工作树，因此默认共享 `project_id` 和 store routes。只有在 linked
worktree 自己的 `.fabric/fabric-config.json` 显式配置 `workspace_binding_id`，才隔离
该 worktree 的 binding/hook state。零 root 或多 root 歧义不应猜测最近项目；请让
client 提供单一 workspace root，或使用显式 pinned 模式。

开发 generated hook runtime 时运行
`pnpm --filter @fenglimg/fabric-cli build:hook-project-context`，并让 byte-parity test
验证生成的 CJS。`packages/server-http-experimental` 仍是 quarantine：不属于主 pnpm
workspace、主线依赖或 release gates，也不要用它验证 stdio MCP 的 root 行为。

## First 30 minutes — troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `fabric doctor` shows a JSON dump | Outdated global CLI (rc.30 against rc.31+ project schema) | `npm install -g @fenglimg/fabric-cli@latest` + re-run `fabric install` |
| AI ignores hint output like `KT-PIT-0001 · KT-PIT-0001` | Opaque summaries (description.summary == stable_id) | Run `/fabric-review` skill OR wait for the rc.35 hint-renderer fallback to extract frontmatter `summary` automatically |
| `fabric-archive` skill never fires | Hooks not wired in `.claude/settings.json` | `fabric install` re-injects hooks idempotently |
| AI never writes `KB:` cite lines | Cite policy text not in your AGENTS.md managed block | `fabric install` re-syncs the cite policy block |
| SKILL.md feels too long to read | It is — designed as a phase navigator, not a manual | Skim Hard Rules + the phase you're currently in; ref files have details |

## Further reading

- `docs/ARCHITECTURE.md` — current package / surface / install pipeline map
- `docs/RUNTIME-CONTRACTS.md` — CLI, MCP, schema and config contract entry
- `docs/TESTING.md` — test strategy and drift gates
- `docs/UPGRADE.md` — supported upgrade notes
- `docs/KNOWLEDGE-MATURITY.md` — draft / verified / proven + retire path
- `AGENTS.md` — **AI policy file** (for AI assistants, not onboarding)
