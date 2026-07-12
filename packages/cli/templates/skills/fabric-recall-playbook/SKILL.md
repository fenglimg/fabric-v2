---
name: fabric-recall-playbook
description: "Knowledge retrieval playbook — when/how to fab_recall, lazy body Read, pending triage, failure paths, and evidence-vs-knowledge boundary. Use before editing files, when knowledge might apply, when user asks why something was decided, or when retrieval seems empty."
---

# fabric-recall-playbook — retrieval playbook

Fabric is **curated knowledge**, not local evidence memory (logs/terminal/session dumps). This skill teaches **how to use** existing MCP/CLI retrieval — it does not replace `fab_recall` and does not capture terminal output.

## Mental model

| Layer | Product | Question |
| --- | --- | --- |
| Evidence | companion tools (optional) | What just happened (command/test/session)? |
| **Knowledge** | **Fabric** | What should we remember (decision/pitfall/guideline)? |
| Orchestration | maestro-flow | How do we execute work? |

**One-way pipeline only:** evidence → human/skill dewatering → `pending` → `fabric-review` → canonical.  
**Never:** auto-promote logs/transcripts to canonical; invent cites without recall.

## Default workflow (agent)

1. **Before editing files** — call `fab_recall(paths=[...], session_id=...)`.
2. **Rank by description** — use `must_read_if` / `impact` / summary; do **not** bulk-read every body.
3. **On demand body** — `Read` only selected `entries[].read_path` (native Read = body consumption).
4. **Apply or dismiss** — if a hit is wrong scope/outdated, say `dismissed: <id> (reason)`.
5. **Backlog / search pending** — `fab_pending action=list|search` (not glob local `.fabric/knowledge/pending`).
6. **Empty / surprising results** — run diagnostics (below); do not invent stable_ids.

## Scenario playbooks

### A. About to edit code
- `fab_recall(paths=[files you will touch], intent="optional short goal")`
- Read at most the top few high-impact bodies
- Cite is automatic when recall paths overlap edits (no forced `KB:` line)

### B. User asks "why did we decide X?" / prior pitfall
- `fab_recall` with intent + related paths, or `fab_pending action=search query="..."`
- Prefer decisions/pitfalls with matching tags or paths
- Verify body before claiming the decision text

### C. Pending backlog / review prep
- `fab_pending action=list` (filters as needed)
- Route write/triage through `fabric-review` skill — this skill is read-side only

### D. "Nothing surfaced" / wrong knowledge
1. Confirm store bind + write route (`fabric store list` / `fabric doctor`)
2. `fabric audit why-not-surfaced <id>` when id known
3. Broaden `intent` or paths; check `semantic_scope` / project bind
4. If still empty: say so and continue with normal tools — **do not fabricate KB**

### E. User pastes logs / wants terminal evidence
- Treat as **evidence**, not knowledge
- Fix with normal tools; if durable rule emerges, `fabric-archive` → pending → review
- Optional: mention a local evidence companion; **do not** shell-capture into Fabric

## Safety (non-interactive)

- Prefer MCP tools already available; avoid opening TUIs or destructive store ops
- Do not dump entire store into context
- Do not claim current repo state from knowledge alone — verify files/commands
- Lifecycle writes: `fabric-archive` / `fabric-review` only (not this skill)

## Failure paths (must not skip)

| Symptom | Do |
| --- | --- |
| Empty `entries[]` | Diagnose bind/scope; broaden intent; admit gap |
| Only low-relevance hits | Read none or one; dismiss with reason |
| `no write-target` on propose | Not this skill — see write/MCP cwd pitfalls; still may recall |
| User wants "agent memory of last command" | Evidence layer; not Fabric core |

## Related skills

- `fabric-archive` — propose pending from session insight
- `fabric-review` — approve/reject/retire/relate
- `fabric-store` / `fabric-sync` — store ops / git sync

## Out of scope

- Terminal/shell capture hooks
- WorkSet-like intermediate knowledge storage
- Changing recall ranking/fusion engines
- Auto-archive from logs
