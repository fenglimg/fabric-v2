# Security Policy

## Supported versions

Fabric is in active v2.0.0 GA development. Security fixes are applied to the latest published `2.0.x` line.

| Version | Supported |
| --- | --- |
| v2.0.x | ✅ |
| v1.x | ❌ (legacy `fabric serve` HTTP path quarantined to `packages/server-http-experimental/`) |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security reports.**

Email <fenglimg90@gmail.com> with:

- A clear description of the issue (what / where / how).
- Steps to reproduce, or a minimal proof of concept.
- The Fabric version (`fabric --version`) and AI client / environment.
- Your assessment of impact (data exposure, code execution, etc.).

You will receive an acknowledgement within 7 days. Triage, fix, and coordinated disclosure timelines depend on severity.

## Scope

In scope:

- The published npm packages: `@fenglimg/fabric-cli`, `@fenglimg/fabric-server`, `@fenglimg/fabric-shared`.
- Skill / hook code shipped by `fabric install`.
- The MCP stdio protocol surface (tool inputs / outputs / event ledger writes).
- Doctor `--fix` write paths and atomic-write guards.

Out of scope:

- The quarantined `packages/server-http-experimental/` package (not built or shipped to npm).
- Third-party AI clients (Claude Code, Cursor, Codex CLI) — report there.
- General prompt-injection of LLMs via knowledge entries (Fabric scrubs known patterns via `INJECTION_PATTERNS` in `packages/server/src/services/extract-knowledge.ts`; novel evasions are useful research and welcome via email).

## Hardening notes

- Knowledge entry bodies are scanned for prompt-injection patterns (`ignore previous`, `forget your role`, ChatML envelopes, `rm -rf /`, shell eval/curl pipes) at extraction time and during `fabric doctor --suspicious-kb` lint.
- The `.fabric/events.jsonl` ledger truncates each string field to 4 KB (POSIX PIPE_BUF atomicity guarantee).
- `fabric install` never writes outside the workspace it was invoked in; personal-layer reads/writes target `~/.fabric/` only.
- MCP stdio is local-only — no listening socket, no remote access surface in mainline.

## Disclosure preference

We follow standard coordinated disclosure: confidential fix, then public disclosure with credit (unless reporter prefers anonymity).
