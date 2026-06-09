# Output Contract — fabric-review

Bilingual roll-up templates + events.jsonl atomicity constraint referenced from SKILL.md.

## Roll-up Template

After each invocation, the skill MUST produce a brief roll-up to the user. UX i18n Policy class 1 — roll-up templates; render per `fabric_language`. Protected tokens (event-type strings such as `knowledge_promoted` / `knowledge_layer_changed` / `knowledge_rejected` / `knowledge_deferred`, plus `.fabric/events.jsonl`) appear verbatim in BOTH variants:

**en variant** (`fabric_language === "en"`):

```md
# Review Summary — mode={pending|topic|health|revisit}
- Listed: N entries
- Approved: M (new stable_ids: KT-D-12, KT-G-4, KP-P-2)
- Rejected: R
- Modified: U (incl. K layer flips)
- Deferred: D
- Skipped: S

## Events appended (.fabric/events.jsonl tail)
- knowledge_promote_started ×M
- knowledge_promoted ×M
- knowledge_layer_changed ×K
- knowledge_rejected ×R
- knowledge_deferred ×D
```

**zh-CN variant** (`fabric_language === "zh-CN"`):

```md
# Review 汇总 — mode={pending|topic|health|revisit}
- 列出: N 条
- 已批准: M (新分配 stable_ids: KT-D-12, KT-G-4, KP-P-2)
- 已驳回: R
- 已修改: U (含 K 次 layer 切换)
- 已延后: D
- 已跳过: S

## 追加事件 (.fabric/events.jsonl 末尾)
- knowledge_promote_started ×M
- knowledge_promoted ×M
- knowledge_layer_changed ×K
- knowledge_rejected ×R
- knowledge_deferred ×D
```

Also surface the target store alias/UUID for every mutation so the user can inspect that store repo's `git status` when needed.

## events.jsonl Constraint Note

Event lines appended to `.fabric/events.jsonl` are subject to POSIX single-write atomicity: only writes ≤ 4KB (`PIPE_BUF`) are guaranteed atomic via `Bash: echo "..." >> file`. Lines exceeding 4KB risk interleaved corruption under concurrent skill + server writes to the same ledger.

Skills MUST ensure:

- Each event JSON line is a **single line** (no embedded newlines; escape `\n` in any string value).
- `session_context` and other free-form text fields **self-truncate** to keep the entire serialized line under 4KB. Suggested per-field caps: `session_context` first 500 chars; `source_sessions` cap at 5 entries; `recent_paths` cap at 20 entries; `user_messages_summary` first 500 chars.
- If approaching the 4KB ceiling after the per-field caps, drop optional fields (e.g. tags / extra metadata) **before** truncating semantic content (the summary / context that carries the actual observation).
- The promote / reject / modify / defer events listed above are emitted by the MCP server via `appendEventLedgerEvent` and are already length-bounded server-side; this constraint applies to any event the skill itself appends directly to the ledger (rare, but possible for diagnostic markers).
