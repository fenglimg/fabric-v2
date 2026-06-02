# G-CROSSCLIENT + G-COLDSTART Evidence

## G-CROSSCLIENT — script/MCP level VERIFIED; app-level needs-real-client

### Verified deterministically (real hook execution, not just config inspection)
- **Hook scripts byte-identical across Claude / Codex / Cursor** — all 4 hooks (fabric-hint, knowledge-hint-broad, knowledge-hint-narrow, cite-policy-evict) diff-clean claude==codex==cursor. Single-CJS-across-clients (KT-DEC-0009) confirmed.
- **broad SessionStart hook FIRES with real content** — executed `knowledge-hint-broad.cjs` with simulated stdin payload against real pcf → emitted the 8-entry knowledge banner + revision_hash + next-step guidance. ✓
- **PreToolUse / Stop hooks execute without crash** — narrow + fabric-hint run, exit 0.
- **`plan-context-hint` subcommand works** — returns broad/narrow classified entries + counts.
- **MCP server tools functional** — recall/planContext/getKnowledgeSections exercised throughout all gates against the dev-build server.
- **Codex MCP wired** — `~/.codex/config.toml` has `[mcp_servers.fabric]` (refutes old F5).

### needs-real-client (honest — cannot automate)
Spawning a REAL Codex CLI session / Cursor app session and observing the client ACTUALLY invoke SessionStart/PreToolUse/Stop hooks + MCP tools in-app cannot be automated here (no headless client-app harness). The scripts + configs are correct and execute standalone; whether each client's runtime actually triggers them on real sessions requires a real interactive client. **Marked needs-real-client per the L-PARTIAL designation.**

### Findings
- **F-NARROW-BUDGET** (efficacy, confirmed, fix deferred to injection infra): narrow path-anchored entries are NOT prioritized in candidate selection. Authored a `maturity:proven, relevance_scope:narrow, relevance_paths:[src/auth/**]` entry (KT-PIT-7777):
  - 20-entry corpus: KT-PIT-7777 surfaces for EVERY edit path (src/db, README.md, unrelated) — no path-gate at small scale (pool not full).
  - 300-entry corpus: KT-PIT-7777 does NOT surface even editing `src/auth/login.ts` (its exact match) — crowded out of the 24-candidate budget by denser broad entries (loses on BM25).
  - Net: a path-anchored narrow entry can't reliably surface on its matching path (the exact use case narrow scoping exists for). Connects to known injection debt (KT-PIT-9105 "rc.5/rc.6 narrow 路径门控 从未真正激活"; candidate-pool A1/A2/A6 injection ❌). Fix = injection priority redesign = feature work → deferred.
- **F-MATURITY-ENDORSED** (declared-vs-impl, confirmed, low): `maturity: endorsed` is rejected by the schema enum `["draft","verified","proven"]` (api-contracts.ts:38) → entry silently skipped (`[fabric] frontmatter: unknown maturity "endorsed"; skipping`), yet `fabric-config.ts` references "endorsed" as a maturity level (orphan_demote_endorsed_days; comment "stable=90/endorsed=30/draft=14"). Config vocab ⊥ schema enum. Real entry KT-PIT-9101 uses it (a dogfood fixture). Minor inconsistency; any genuine endorsed entry would be dropped.

## G-COLDSTART — fresh install→use journey walked, gaps logged
- `git init` fresh repo → `fabric install --yes` → bootstrap 121 installed, mcp 4 clients configured, hooks 2 installed, all 4 clients "就绪". Exit 0. ✓
- `fabric status` on fresh install → uid + mounted stores + (project_id "(unset)" after F9 fix). ✓
- recall on fresh project → empty KB (correct — no knowledge authored yet; the expected cold-start state).
- **First-use gaps logged**:
  1. (FIXED) status said "(not a Fabric project)" on fresh install — F9.
  2. fresh `fabric-config.json` lacks `required_stores` → `status` shows "required: (none)" (install scaffolds minimal config without the personal required_store the project's own config later carries).
  3. installing rewrites GLOBAL `~/.codex/config.toml` fabric mcp path to this project's server (multi-project share one global codex MCP path — by-design for npm-global prod path).
- Journey is walkable end-to-end; the cold-start experience is functional (install → status → ready-for-knowledge).

## Verdicts
- **G-CROSSCLIENT**: PARTIAL/honest — script+config+MCP+hook-execution verified deterministically; real-client-app interactive triggering marked **needs-real-client** (not faked).
- **G-COLDSTART**: MET — fresh install→status→use journey walked; gaps logged (1 fixed, 2 minor by-design/config).
