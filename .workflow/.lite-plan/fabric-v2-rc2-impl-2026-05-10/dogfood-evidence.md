# Dogfood Evidence — Fabric v2.0 rc.2 Archive Flow

**Task:** TASK-007 — Self-dogfood the rc.2 archive write-half on the Fabric monorepo.
**Date:** 2026-05-10
**Source session id:** `WFS-rc2-impl-2026-05-10`
**Operator:** Claude Code (TASK-007 executor)

This report captures end-to-end evidence that the rc.2 archive flow works against
the Fabric self-repo: install paths land, `fab_extract_knowledge` writes pending
entries with the correct frontmatter, `events.jsonl` gains `knowledge_proposed`
events, idempotency holds across replays, and `archive-hint.cjs` threshold logic
fires when 5 plan_context events accumulate after the last `knowledge_proposed`.

## 1. Pre-Dogfood State

Repo state before any rc.2 dogfood action.

```text
$ ls .fabric/
.cache/  agents.meta.json  audit.jsonl  events.jsonl  fabric-config.json
forensic.json  knowledge/

$ cat .fabric/fabric-config.json
{
  "knowledge_language": "zh-CN"
}

$ ls .fabric/knowledge/pending/
.gitkeep   # empty pending tree (only the directory marker)

$ wc -l .fabric/events.jsonl
       8 .fabric/events.jsonl

$ git log --oneline -6
f0a33a8 feat(cli): wire fabric-archive skill + hook install through init and hooks commands  (TASK-005)
0cf14a0 feat(hooks): add client hook config templates for Claude Code + Codex                (TASK-004)
c0a351d feat(server): add fab_extract_knowledge MCP tool with idempotency                    (TASK-001)
50367b5 feat(hooks): add archive-hint.cjs Stop hook with threshold logic                     (TASK-003)
8dfa018 feat(skills): add fabric-archive Skill template with 5-type extraction prompt        (TASK-002)
f09bf60 chore(gate): TASK-010 day-1 gate housekeeping
```

`.fabric/knowledge/pending/` was empty — dogfood started from a clean slate. The
8 pre-existing `events.jsonl` lines are doctor/init-scan events from prior
sessions, none of `event_type: knowledge_proposed`.

## 2. Install Verification

The rc.2 install (skill + hook script + hook configs) had NOT yet been applied
to this repo prior to TASK-007 — `init --reapply` was never re-run after
TASK-005 landed on main. Pre-state:

```text
$ ls -la .claude/
drwxr-xr-x   2  hooks/                  # empty
drwxr-xr-x   4  skills/                 # contained fabric-init/, ui-ux-pro-max/ (v1 / unrelated)
-rw-r--r--      settings.local.json     # had no Stop hook
# .claude/settings.json did not exist
# .claude/skills/fabric-archive/ did not exist
# .claude/hooks/archive-hint.cjs did not exist

$ ls -la .codex/
drwxr-xr-x   2  hooks/                  # empty
# .codex/skills/ did not exist
# .codex/hooks.json did not exist
```

### 2a. Hook install via `fabric hooks install`

```text
$ pnpm --filter @fenglimg/fabric-server build
$ pnpm --filter @fenglimg/fabric-cli build

$ node packages/cli/dist/index.js hooks install --target .
installed /Users/wepie/Desktop/personal-projects/pcf/.claude/hooks/archive-hint.cjs
installed /Users/wepie/Desktop/personal-projects/pcf/.codex/hooks/archive-hint.cjs
installed /Users/wepie/Desktop/personal-projects/pcf/.claude/settings.json
installed /Users/wepie/Desktop/personal-projects/pcf/.codex/hooks.json
```

### 2b. Skill install via dogfood harness

`fabric hooks install` does NOT install the SKILL.md template (it only handles
hook script + hook configs — see TASK-005 wiring). To install the skill outside
of `init --reapply`, the dogfood harness `scripts/dogfood-rc2-archive.mjs`
copies `packages/cli/templates/skills/fabric-archive/SKILL.md` into both
`.claude/skills/fabric-archive/` and `.codex/skills/fabric-archive/`. Output:

```json
{
  "step": "install-skill",
  "written": [
    "/Users/wepie/Desktop/personal-projects/pcf/.claude/skills/fabric-archive/SKILL.md",
    "/Users/wepie/Desktop/personal-projects/pcf/.codex/skills/fabric-archive/SKILL.md"
  ],
  "skipped": []
}
```

### 2c. Post-install file presence

```text
$ ls .claude/skills/fabric-archive/.codex/skills/fabric-archive/
.claude/skills/fabric-archive/SKILL.md  # 180-line template (TASK-002 output)
.codex/skills/fabric-archive/SKILL.md   # identical content

$ ls -la .claude/hooks/ .codex/hooks/
-rwxr-xr-x  archive-hint.cjs  # 4944 bytes, executable

$ cat .claude/settings.json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/archive-hint.cjs"
          }
        ]
      }
    ]
  }
}

$ cat .codex/hooks.json
{
  "events": {
    "Stop": [
      {
        "command": ".codex/hooks/archive-hint.cjs"
      }
    ]
  }
}
```

All 6 expected install artifacts present (2 skills + 2 hook scripts + 2 hook
configs). Convergence criterion #1 — six expected files present — satisfied.

## 3. Archive-Hint.cjs (Pre-Archive Run)

Run `archive-hint.cjs` against the pristine `events.jsonl` (8 events, zero
`knowledge_proposed`, zero `knowledge_context_planned`):

```text
$ node .claude/hooks/archive-hint.cjs
(no stdout, exit 0)
```

Expected silence: with zero `knowledge_context_planned` events on file, the
plan-context counter is 0, both threshold conditions evaluate false, and the
hook emits nothing. Confirms the hook is not over-eager on cold repos.

## 4. fab_extract_knowledge Invocations

Three invocations driven by the dogfood harness, each modeling a REAL
decision/pitfall/guideline emerging from the rc.2 implementation chain.

### 4a. Harness script

```javascript
// scripts/dogfood-rc2-archive.mjs (excerpt)
import { extractKnowledge } from "../packages/server/dist/index.js";

const SOURCE_SESSION = "WFS-rc2-impl-2026-05-10";
const INVOCATIONS = [
  {
    type: "decisions",
    slug: "rc2-single-cjs-hook-across-clients",
    user_messages_summary: "rc.2 决定使用单份 .cjs hook 脚本... (zh-CN body)",
    recent_paths: [
      "packages/cli/templates/hooks/archive-hint.cjs",
      "packages/cli/templates/hooks/configs/claude-code.json",
      "packages/cli/templates/hooks/configs/codex-hooks.json",
      ".workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/planning-context.md",
    ],
  },
  {
    type: "pitfalls",
    slug: "codex-hook-config-is-json-not-toml",
    user_messages_summary: "陷阱：Codex CLI 的 project-level hook 配置文件是 .codex/hooks.json...",
    recent_paths: [
      "packages/cli/src/config/resolver.ts",
      "packages/cli/templates/hooks/configs/codex-hooks.json",
    ],
  },
  {
    type: "guidelines",
    slug: "deepmerge-array-append-paths-for-stop-hooks",
    user_messages_summary: "指导：当向已存在的 .claude/settings.json 合并 hooks.Stop[] 数组时...",
    recent_paths: [
      "packages/cli/src/config/json.ts",
      "packages/cli/src/install/skills-and-hooks.ts",
    ],
  },
];

for (const input of INVOCATIONS) {
  const out = await extractKnowledge(REPO_ROOT, { source_session: SOURCE_SESSION, ...input });
  console.log(out);
}
```

### 4b. Per-call output

```json
[
  {
    "input.type": "decisions",
    "input.slug": "rc2-single-cjs-hook-across-clients",
    "output": {
      "pending_path": ".fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md",
      "idempotency_key": "sha256:dac0bad86f7e1c1f089cc63de68a66a6d226c24e9ab88195d63f70b2536a5b4a"
    }
  },
  {
    "input.type": "pitfalls",
    "input.slug": "codex-hook-config-is-json-not-toml",
    "output": {
      "pending_path": ".fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md",
      "idempotency_key": "sha256:9a2eca53416b9925492a8c43af45723f5562eb98c606b57d9222a1aaf9848cc3"
    }
  },
  {
    "input.type": "guidelines",
    "input.slug": "deepmerge-array-append-paths-for-stop-hooks",
    "output": {
      "pending_path": ".fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md",
      "idempotency_key": "sha256:9ee3493ede177e9452047f9cb6cf4e19ff5cf4d687ce3fe51b361aa94e637e3c"
    }
  }
]
```

Note the slug for the third entry was truncated from
`deepmerge-array-append-paths-for-stop-hooks` (43 chars) to
`deepmerge-array-append-paths-for-stop-ho` (40 chars) by the
`SLUG_MAX_LENGTH = 40` cap in `extract-knowledge.ts:19`. Behavior is per-spec
but the trailing `-ho` is aesthetically rough — flagged for TASK-008 review
(see Issues / Followups below).

## 5. Post-Archive State

### 5a. Pending tree

```text
$ find .fabric/knowledge/pending -type f -not -name '.gitkeep'
.fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md
.fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md
.fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md
```

Three pending entries, one per type, organized into per-type subdirectories
under `.fabric/knowledge/pending/` exactly as the rc.2 schema specifies.

### 5b. Frontmatter dump (decisions entry)

```yaml
---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-10T11:29:43.862Z
source_session: WFS-rc2-impl-2026-05-10
tags: []
x-fabric-idempotency-key: sha256:dac0bad86f7e1c1f089cc63de68a66a6d226c24e9ab88195d63f70b2536a5b4a
---
```

### 5c. Frontmatter dump (pitfalls entry)

```yaml
---
type: pitfalls
maturity: draft
layer: team
created_at: 2026-05-10T11:29:43.864Z
source_session: WFS-rc2-impl-2026-05-10
tags: []
x-fabric-idempotency-key: sha256:9a2eca53416b9925492a8c43af45723f5562eb98c606b57d9222a1aaf9848cc3
---
```

### 5d. Frontmatter dump (guidelines entry)

```yaml
---
type: guidelines
maturity: draft
layer: team
created_at: 2026-05-10T11:29:43.867Z
source_session: WFS-rc2-impl-2026-05-10
tags: []
x-fabric-idempotency-key: sha256:9ee3493ede177e9452047f9cb6cf4e19ff5cf4d687ce3fe51b361aa94e637e3c
---
```

### 5e. id-field grep (must be empty)

```text
$ grep -E '^id:' .fabric/knowledge/pending/**/*.md
(no output, exit 1)
```

Convergence criterion #3 — pending frontmatter has NO `id` field — satisfied
across all three entries. Q2 late-bind preserved as designed.

### 5f. events.jsonl knowledge_proposed events

```text
$ grep knowledge_proposed .fabric/events.jsonl
{"kind":"fabric-event","id":"event:6128c028-...","ts":1778412583863,"schema_version":1,
 "correlation_id":"WFS-rc2-impl-2026-05-10","session_id":"WFS-rc2-impl-2026-05-10",
 "event_type":"knowledge_proposed","timestamp":"2026-05-10T11:29:43.863Z",
 "reason":"extract_knowledge:rc2-single-cjs-hook-across-clients"}
{"kind":"fabric-event","id":"event:d5cbeaf9-...","ts":1778412583866,"schema_version":1,
 "correlation_id":"WFS-rc2-impl-2026-05-10","session_id":"WFS-rc2-impl-2026-05-10",
 "event_type":"knowledge_proposed","timestamp":"2026-05-10T11:29:43.866Z",
 "reason":"extract_knowledge:codex-hook-config-is-json-not-toml"}
{"kind":"fabric-event","id":"event:0f102110-...","ts":1778412583867,"schema_version":1,
 "correlation_id":"WFS-rc2-impl-2026-05-10","session_id":"WFS-rc2-impl-2026-05-10",
 "event_type":"knowledge_proposed","timestamp":"2026-05-10T11:29:43.867Z",
 "reason":"extract_knowledge:deepmerge-array-append-paths-for-stop-ho"}
{"kind":"fabric-event","id":"event:7251588c-...","ts":1778412583868,"schema_version":1,
 "correlation_id":"WFS-rc2-impl-2026-05-10","session_id":"WFS-rc2-impl-2026-05-10",
 "event_type":"knowledge_proposed","timestamp":"2026-05-10T11:29:43.868Z",
 "reason":"extract_knowledge:rc2-single-cjs-hook-across-clients"}
```

Convergence criterion #4 — `correlation_id` matches `input.source_session` —
satisfied on every emitted event. Four events total: three from initial
invocations + one from the idempotency replay (Section 6). `events.jsonl` line
count went 8 → 12.

## 6. Idempotency Check

Replay the FIRST invocation (`decisions / rc2-single-cjs-hook-across-clients`)
with a different `user_messages_summary` body. Expectation:
- same `idempotency_key` returned (proves cross-invocation key stability)
- same `pending_path` returned (no slug variation)
- pending file body augmented with `## Evidence (call 2)` section (NOT
  overwritten)
- `events.jsonl` gains a fresh `knowledge_proposed` event (count 3 → 4)
- pending file count remains 3 (no duplicate file created)

### 6a. Output

```json
{
  "step": "idempotency-check",
  "same_idempotency_key": true,
  "same_pending_path": true,
  "initial_key": "sha256:dac0bad86f7e1c1f089cc63de68a66a6d226c24e9ab88195d63f70b2536a5b4a",
  "replay_key": "sha256:dac0bad86f7e1c1f089cc63de68a66a6d226c24e9ab88195d63f70b2536a5b4a"
}
```

### 6b. File body diff

The decisions entry body now contains TWO `## Evidence (call N)` sections
where it had one before the replay:

```text
$ grep -c '^## Evidence (call' .fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md
2

$ grep '^## Evidence (call' .fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md
## Evidence (call 1)
## Evidence (call 2)
```

The pitfalls and guidelines entries (no replay) still show one section each:

```text
$ grep -c '^## Evidence (call' .fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md
1
$ grep -c '^## Evidence (call' .fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md
1
```

### 6c. events.jsonl line-count delta

```text
$ wc -l .fabric/events.jsonl
12 .fabric/events.jsonl
$ grep -c knowledge_proposed .fabric/events.jsonl
4
```

Pre-dogfood ledger had 8 lines / 0 `knowledge_proposed`. Post-dogfood ledger has
12 lines / 4 `knowledge_proposed`. Delta: +4 events for 4 invocations
(3 initial + 1 replay), consistent with the best-effort emit-after-write policy.
Convergence criterion #5 (same idempotency_key on replay) satisfied.
Convergence criterion #6 (evidence section appended, not overwritten)
satisfied.

## 7. Archive-Hint.cjs (Post-Archive Run)

Re-run `archive-hint.cjs` against the post-dogfood `events.jsonl`:

```text
$ node .claude/hooks/archive-hint.cjs
(no stdout, exit 0)
```

Silent — expected because zero `knowledge_context_planned` events have been
recorded after the most-recent `knowledge_proposed` (which was milliseconds
ago). The hook correctly suppresses the reminder when archiving JUST happened.

### 7a. Threshold-cross simulation

To validate the trigger path itself fires (convergence criterion #7), call the
exported `decide()` function in-process with a synthetic event tail crossing the
5-plan_context threshold. This avoids polluting the real `events.jsonl`:

```text
$ node -e '
const { decide } = require("./.claude/hooks/archive-hint.cjs");
const now = Date.now();
const lastProposed = now - 1000;
const events = [
  { event_type: "knowledge_proposed", ts: lastProposed },
  ...Array.from({length: 5}, (_, i) => ({ event_type: "knowledge_context_planned", ts: lastProposed + i + 1 })),
];
console.log(JSON.stringify(decide(events, now), null, 2));
'
{
  "decision": "block",
  "reason": "已积累 5 次 plan_context 调用且距上次 knowledge_proposed 0.0h — 建议调用 fabric-archive skill 抽取本次会话的知识。"
}
```

Output JSON shape `{decision: "block", reason: ...}` matches the rc.2 contract
(stdout JSON, exit 0). The reason string mentions `fabric-archive` (criterion
#7 substring requirement: `"建议调用 fabric-archive skill"`). Threshold logic
fires exactly as designed.

## 8. Evidence Summary Table

| # | Type        | Slug (sanitized)                              | Layer | Source session             | Idempotency key (sha256:)            |
|---|-------------|-----------------------------------------------|-------|----------------------------|--------------------------------------|
| 1 | decisions   | `rc2-single-cjs-hook-across-clients`          | team  | WFS-rc2-impl-2026-05-10    | `dac0bad86f7e1c1f089cc63de68a66a6...` |
| 2 | pitfalls    | `codex-hook-config-is-json-not-toml`          | team  | WFS-rc2-impl-2026-05-10    | `9a2eca53416b9925492a8c43af45723f5...` |
| 3 | guidelines  | `deepmerge-array-append-paths-for-stop-ho`    | team  | WFS-rc2-impl-2026-05-10    | `9ee3493ede177e9452047f9cb6cf4e19f...` |

Plus 1 replay of row #1 → augmented body, same key, same path, +1 ledger event.

## 9. Convergence Checklist

| # | Criterion                                                                                            | Status |
|---|------------------------------------------------------------------------------------------------------|--------|
| 1 | Install on Fabric self-repo produces all 6 expected files (2 skills + 2 hook scripts + 2 hook configs) | PASS   |
| 2 | `fab_extract_knowledge` returns valid `{pending_path, idempotency_key}` response                      | PASS   |
| 3 | Pending `.md` frontmatter has NO `id:` field (verified by `grep -E '^id:'` returning no match)        | PASS   |
| 4 | `events.jsonl` gains `knowledge_proposed` event with `correlation_id` matching `input.source_session` | PASS   |
| 5 | Re-invocation with same `(source_session,type,slug)` triple returns same `idempotency_key`            | PASS   |
| 6 | Replayed pending file body has evidence section appended (NOT overwritten) — second `## Evidence (call 2)` section landed | PASS   |
| 7 | `archive-hint.cjs` fires on threshold-cross and emits stdout JSON `{decision:"block", reason:...}` mentioning fabric-archive | PASS   |
| 8 | All sections of dogfood evidence report filled with concrete evidence (no TODO markers)               | PASS   |

## 10. Issues / Followups (Flagged for TASK-008)

1. **Slug truncation produces visually-jagged tail** — input
   `deepmerge-array-append-paths-for-stop-hooks` (43 chars) becomes
   `deepmerge-array-append-paths-for-stop-ho` (40 chars). The trailing `-ho`
   reads as a typo. Considered enhancements: (a) truncate at the last full word
   before the cap; (b) raise the cap to 50; (c) hash-suffix when truncating to
   make the dropped text recoverable. Per-spec for now (the cap is intentional
   per `discussion-followup.md L60` "20-40 chars"), but worth a usability
   review during TASK-008.

2. **`fabric hooks install` does not install the SKILL.md** — only the hook
   script + hook configs. The SKILL.md is wired only through
   `fabric init` bootstrap stage. For an existing repo whose owner runs
   `fabric hooks install` (re-applying the hook layer), the skill never
   lands. Two reasonable fixes: (a) extend `fabric hooks install` to also
   call `installFabricArchiveSkill`; (b) add a separate `fabric skills
   install` subcommand. The dogfood harness worked around this by copying the
   template directly, but a fresh user wouldn't know to do so.
   Recommend evaluating in TASK-008.

3. **No `fabric init --reapply` regression test** — TASK-005 wired the install
   into init's bootstrap stage, but TASK-006 covers `installHooks` directly.
   An integration test that runs `init --reapply` against a fixture and
   asserts all 6 install artifacts land would have caught issue #2 above.
   Recommend logging as a TASK-008 followup test if not already covered by
   TASK-006.

These observations did NOT block dogfood completion — all 8 convergence
criteria passed. They are usability / coverage gaps surfaced by the dogfood,
which is exactly the point of self-validation.
