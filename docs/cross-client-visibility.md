# Cross-Client Stderr Visibility — Fabric Hook Reminders

> **Status:** rc.12 documentation skeleton — manual screenshot capture is a
> separate dogfood task tracked by maintainers. The contract below documents
> *where* each supported client renders Fabric hook stderr; the actual visual
> verification round is appended once captured. PRs adding screenshots welcome.

## Background

Fabric ships two hook scripts that emit human-readable banners to **stderr**
under specific conditions:

| Hook                                 | Event        | Trigger                                                                   |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------- |
| `templates/hooks/knowledge-hint-broad.cjs` | SessionStart | Unconditionally fires on every SessionStart (Skill-style progressive disclosure) |
| `templates/hooks/fabric-hint.cjs`    | Stop         | One of four signals (A archive / B review / C import / D maintenance) fires |
| `templates/hooks/knowledge-hint-narrow.cjs` | PreToolUse   | Edit/Write/MultiEdit on a path with matching narrow knowledge entry       |

All three follow the same failure invariant: any error path → silent exit 0,
never block the host tool. They write to stderr only (Stop hook may also write
a `decision:block` JSON to stdout for action-required signals).

This document tracks where each of the three supported clients (Claude Code,
Cursor, Codex CLI) renders that stderr stream in their UI so users know what
to look for.

---

## Claude Code

**Where stderr appears**

Claude Code surfaces hook stderr inline in the assistant turn that triggered
the hook event. For SessionStart, stderr appears as a system message at the
very top of the new session (above the first user prompt). For Stop hook
JSON output (the `decision:block` payload with `signal` and `reason`), the
`reason` text is rendered as an in-line system note attached to the assistant
turn that triggered the Stop.

**Banner shape rendered**

The 人-first banner introduced in rc.7 T4 renders cleanly on Claude Code's
markdown-aware system-note view: the `📋` emoji prefix, the three indented
lines, and embedded backticks (` ` `fabric doctor --lint` ` `) all display
correctly.

**Gotchas**

- Cooldown sidecars (`archive-hint-shown.json`, `maintenance-hint-last-emit`)
  live in `.fabric/.cache/` — if you don't see an expected Stop-hook banner,
  check whether the sidecar is suppressing it.
- SessionStart broad-menu emission is unconditional in rc.12+ — every
  SessionStart fire (including compact/clear-triggered re-fires) re-injects
  the menu. This is intentional progressive disclosure: the agent must
  re-encounter the broad knowledge index after context-window resets to
  preserve working memory.

**Screenshot:** _placeholder — to be captured by maintainer during dogfood_

---

## Cursor

**Where stderr appears**

Cursor renders hook stderr through its `followup_message` JSON field
mechanism. The Stop hook's `decision:block` payload carries a `reason` string
which Cursor surfaces as an inline tool-result block above the next user
input. SessionStart stderr appears as a contextual notification at the start
of the new agent thread.

**Banner shape rendered**

UTF-8 emoji (`📋`) and Chinese characters render fine. Multi-line `\n`-
delimited banners render preserving line breaks. The `is_canceled: false`
flag in the JSON payload ensures Cursor treats the banner as an
informational note rather than a hard block.

**Gotchas**

- Cursor's `followup_message` field is only consulted on Stop hooks that
  emit JSON to stdout. SessionStart stderr (broad-injection hook) is
  rendered via a separate notification channel — check Cursor's tool-output
  panel if you don't see it inline.
- Cursor caches some session state in its own format; restarting the
  cursor session forces a fresh SessionStart fire which re-injects the
  broad-knowledge menu.

**Screenshot:** _placeholder — to be captured by maintainer during dogfood_

---

## Codex CLI

**Where stderr appears**

Codex CLI streams hook stderr to the terminal between agent turns. The
SessionStart banner appears as a one-time pre-amble before the first prompt;
Stop hook reasons appear as a block between completion of the prior
assistant message and the next user input prompt.

**Banner shape rendered**

Terminal stderr supports the `📋` emoji and Chinese-language content (assuming
the terminal locale is UTF-8). Multi-line banners render naturally as the
hook writes one `\n` per banner line.

**Gotchas**

- Some terminal emulators strip emoji from stderr if `LANG`/`LC_ALL` is
  misconfigured. Set `LANG=en_US.UTF-8` (or another UTF-8 locale) to ensure
  the `📋` prefix renders.
- The cooldown sidecars described in the Claude Code section apply equally
  to Codex CLI — same `.fabric/.cache/` paths, same semantics.

**Screenshot:** _placeholder — to be captured by maintainer during dogfood_

---

## Verification Checklist (for maintainer dogfood round)

When capturing screenshots, exercise the following scenarios per client:

- [ ] **SessionStart cold start, knowledge present** → banner with broad
  entries listed, `revision_hash:` line at the bottom.
- [ ] **SessionStart re-fire after `/compact`** → broad-menu re-injected
  (verifies rc.12 unconditional emission; compact resets the agent's
  context window, so the menu must re-appear in working memory).
- [ ] **SessionStart re-fire after `/clear`** → broad-menu re-injected
  (same rationale as compact).
- [ ] **Stop hook Signal A** (24h+ since last archive OR ≥20 edits) → 人-
  first banner with `最近活动集中在: ...` line populated from edit-counter.
- [ ] **Stop hook Signal B** (≥10 pending OR oldest pending ≥7d) → review
  banner.
- [ ] **Stop hook Signal C** (canonical < 10 AND init ≥24h ago) → import
  banner.
- [ ] **Stop hook Signal D** (≥14d since last `doctor_run`) → maintenance
  banner with `fabric doctor --lint` CLI prompt.

---

## Related

- `docs/decisions/rc5-a3-superseded.md` — context on the rc.5 plan-context
  protocol that the SessionStart broad-injection hook depends on.
- `docs/configuration.md` — `fabric-config.json` knobs that affect banner
  thresholds (`archive_hint_hours`, `maintenance_hint_days`, etc.).
- `packages/cli/templates/hooks/` — the three hook scripts themselves.
