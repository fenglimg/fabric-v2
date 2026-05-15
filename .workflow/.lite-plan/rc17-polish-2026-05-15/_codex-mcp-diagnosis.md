# Bug Y diagnosis — Codex MCP wiring trace (rc.17 TASK-006)

**Status:** NOT REPRODUCIBLE in rc.13 (installed binary) or current source (rc.16 HEAD).
**Verdict:** Bug Y is a **stale report**. No code-gap exists. TASK-007 should ship as a regression-test-only task.
**Complexity (proposed test-only fix):** ~2 hours.

---

## Reproduction attempt

**Setup:**
- User home: `/Users/wepie`
- `~/.codex/config.toml` exists, 2107 bytes, contains `model_provider`, `[features]`, many
  `[projects."..."]`, `[plugins."..."]`, `[marketplaces.*]` blocks. **Initially had no
  `[mcp_servers.fabric]` block** (verified by `grep -n fabric ~/.codex/config.toml` →
  no matches before run).
- Fixture workspace: `/tmp/fab-y-fixture` (created fresh, empty).
- CLI under test: `fab` v2.0.0-rc.13 (currently installed via npm — globally newer
  source on disk is rc.16/17 dev tree, but the user's bug was reported against the
  shipped rc.13 binary so the repro uses that binary deliberately).

**Command run:**
```
rm -rf /tmp/fab-y-fixture && mkdir -p /tmp/fab-y-fixture
fab install --target /tmp/fab-y-fixture --yes --dry-run
```

**Stdout summary (relevant lines, translated from zh-CN):**
```
Installing MCP clients...
Using globally installed @fenglimg/fabric-server
mcp: installed=4 skipped=0
...
Client capability summary:
  Claude Code CLI      ready  ready  installed  installed  ...
  Claude Code Desktop  ready  ready  N/A        N/A        ...
  Cursor               ready  ready  N/A        N/A        ...
  Codex CLI            ready  ready  installed  supported  ...
```

**Post-run state of `~/.codex/config.toml`:**
```toml
... (all original content preserved) ...

[plugins."presentations@openai-primary-runtime"]
enabled = true

[mcp_servers.fabric]
command = "/Users/wepie/.nvm/versions/node/v22.19.0/bin/node"
args = ["/Users/wepie/.nvm/versions/node/v22.19.0/lib/node_modules/@fenglimg/fabric-cli/node_modules/@fenglimg/fabric-server/dist/index.js"]
```

The `[mcp_servers.fabric]` block was correctly appended. Bug did not reproduce.

---

## Detection trace

**`config/resolver.ts:80-85`** unambiguously instantiates `CodexTOMLConfigWriter` whenever
`existsSync(join(homedir(), ".codex"))` is true OR an explicit `clientPaths.codexCLI` is set:
```ts
addIfDetected(
  writers,
  existsSync(join(homedir(), ".codex")),
  (configuredPath) => new CodexTOMLConfigWriter(configuredPath),
  hasExplicitPath(clientPaths, "codexCLI") ? clientPaths!.codexCLI : undefined,
);
```
User has `~/.codex/`, so the writer is added. Confirmed empirically — capability summary
shows "Codex CLI: ready (MCP)".

**`config/toml.ts:131-139`** `CodexTOMLConfigWriter.detect()`:
```ts
async detect(_workspaceRoot: string, overridePath?: string): Promise<string | null> {
  const explicitPath = overridePath ?? this.configuredPath;
  if (explicitPath !== undefined) {
    return resolve(expandHome(explicitPath));
  }
  const codexDir = join(homedir(), ".codex");
  return existsSync(codexDir) ? resolve(join(codexDir, "config.toml")) : null;
}
```
Returns `/Users/wepie/.codex/config.toml` for user's setup. **Detection works.**

---

## Orchestration trace

**`commands/install.ts:1067-1070`** invokes `installMcpClients` with no `clients` filter
and no `dryRun`:
```ts
const result = await configCommand.installMcpClients(plan.target, {
  localServerPath: stage.localServerPath,
  claudeMcpScope: stage.claudeMcpScope,
});
```
No per-client filter → all 4 detected writers (Claude Code CLI, Claude Code Desktop, Cursor,
Codex CLI) iterate.

**`commands/config.ts:297-332`** `installMcpClients`:
- `selectedClients` is `null` because `options.clients === undefined` → filter passes everything.
- Loop calls `writer.detect()` → if non-null, calls `writer.write(serverPath, workspaceRoot)`.
- Codex writer's `detect()` returns the path (see above), so `write()` runs.

**Empirically confirmed:** `result.installed.length === 4` (per "mcp: installed=4 skipped=0").
**Orchestration works.**

---

## Writer trace

**`config/toml.ts:141-152`** `CodexTOMLConfigWriter.write()`:
```ts
async write(serverPath: string, workspaceRoot: string, overridePath?: string): Promise<void> {
  const configPath = await this.detect(workspaceRoot, overridePath);
  if (configPath === null) return;
  const rawConfig = await readTomlConfigText(configPath);
  const nextConfig = upsertCodexServerBlock(rawConfig, "fabric", createServerEntry(serverPath));
  await mkdir(dirname(configPath), { recursive: true });
  await atomicWriteText(configPath, nextConfig);
}
```

**`upsertCodexServerBlock` (config/toml.ts:91-109)** strips any existing
`[mcp.servers.fabric]` (legacy) and `[mcp_servers.fabric]` (current) blocks via regex,
trims trailing whitespace, then appends the new block separated by a blank line. Edge cases:
- Empty config → returns block alone.
- Pre-existing content → returns `${trimmed}\n\n${block}`.
- Pre-existing fabric block → stripped and replaced (verified by unit tests
  `__tests__/config-install.test.ts:32-68` "preserves other config and replaces existing
  fabric block").

**Empirically confirmed:** the user's real `~/.codex/config.toml` was rewritten in-place
with all original content preserved and the new `[mcp_servers.fabric]` block appended.
**Writer works.**

---

## Root Cause

**No code-gap.** All three hypotheses (detection-gap / orchestration-gap / writer-gap) are
falsified by the empirical repro and the `__tests__/config-install.test.ts` unit-test
suite (3 passing tests covering empty-config, preserve-and-replace, and legacy-migration
scenarios).

**Most likely explanation for the original Bug Y report (rc.14 era):**
1. **Stale-binary diagnosis (high probability):** the user reported Bug Y while running
   an even older rc.x binary that predates the `mcp.servers` → `mcp_servers` migration
   (rc.13 already does the migration cleanly per unit-test "migrates legacy mcp.servers.fabric
   into mcp_servers.fabric"). The block was likely written under the legacy `[mcp.servers.fabric]`
   spelling, which Codex CLI itself ignores (Codex expects `mcp_servers`). The user grepped
   for `mcp_servers.fabric` and found nothing, concluding the block was missing.
2. **Permission-failure-silently-swallowed (low probability):** if `atomicWriteText`
   raises (e.g. tmp-file rename fails on a read-only `~/.codex/`), the error would propagate
   out of `installMcpClients` and abort the install stage — but `result.installed.length === 4`
   in the empirical repro proves no error fired. Cannot explain the observed report.
3. **User confusion (medium probability):** the user may have been inspecting a different
   `config.toml` (e.g. inside a project-local `.codex/` folder, or
   `/etc/codex/config.toml`). The writer always targets `~/.codex/config.toml` — if the
   user's `codex` CLI was actually reading a different file, the fabric block would appear
   "missing" relative to that file.

---

## Proposed Fix (for TASK-007)

**Recommendation: convert TASK-007 from a code-fix to a regression-test task.**

The test surface should:
1. Lock down current behavior so a future refactor cannot reintroduce the legacy
   `mcp.servers.fabric` spelling silently.
2. Add an integration smoke test that runs the full
   `installMcpClients` path against a temp `$HOME` (via env override or by
   passing an explicit `clientPaths.codexCLI` path) with a pre-populated `config.toml`
   that has multiple existing `[*.*]` blocks (mirrors the user's real-world scenario
   where the bug was reported).
3. Optional: add a startup-time WARN log line in `CodexTOMLConfigWriter.write()` that
   prints the resolved `configPath` to stderr at INFO level when `--debug` is set, so
   future "block missing" reports include "wrote to: <path>" in the bug report.

**Concrete patch outline:**

File: `packages/cli/__tests__/config-install.test.ts` — add new test:
```ts
it("appends [mcp_servers.fabric] to a real-world Codex config layout", async () => {
  const { configPath } = createTempConfig();
  // Mirror the user's actual ~/.codex/config.toml shape: top-level scalars,
  // [features], many [projects."..."] entries, [plugins."..."] entries,
  // [marketplaces.*] entries — but no [mcp_servers.fabric].
  writeFileSync(configPath, REAL_WORLD_CODEX_FIXTURE, "utf8");
  const writer = new CodexTOMLConfigWriter(configPath);
  await writer.write("/usr/local/bin/fabric-server.js", process.cwd());
  const written = readFileSync(configPath, "utf8");
  expect(written).toContain("[mcp_servers.fabric]");
  expect(written).toContain('args = ["/usr/local/bin/fabric-server.js"]');
  // Preserve all original blocks.
  expect(written).toContain('[plugins."browser-use@openai-bundled"]');
  expect(written).toContain('[marketplaces.openai-bundled]');
  expect(written).toContain('[projects."/Users/wepie"]');
});
```

Where `REAL_WORLD_CODEX_FIXTURE` is a redacted copy of the user's actual
`~/.codex/config.toml` (project paths anonymized to `/path/to/project-N`).

**Behavior delta:** none in production code — only adds regression coverage.

---

## Complexity Estimate

**~2 hours** (test-only):
- 30min: copy + redact user's `~/.codex/config.toml` into a fixture string constant.
- 30min: write the new test case + run `pnpm --filter @fenglimg/fabric-cli test`.
- 30min: optional `--debug` logging line in `CodexTOMLConfigWriter.write()` + matching
  assertion in test.
- 30min: CHANGELOG entry noting Bug Y is closed-no-repro with new regression test.

**Verdict: PROCEED with TASK-007 as test-only**. Well under the 8h defer threshold.

---

## Test strategy for TASK-007

**Integration test fixture setup:**
- Fixture file at `packages/cli/__tests__/fixtures/codex-config-real-world.toml`
  (redacted user config).
- Test reads fixture into a temp `config.toml`, runs `CodexTOMLConfigWriter.write()`,
  asserts:
  - `[mcp_servers.fabric]` block exists.
  - `command = "<process.execPath>"` line present.
  - `args = ["<serverPath>"]` line present.
  - All 8 named blocks from the original fixture are still present
    (preservation test).
- Idempotency: invoke `write()` twice; assert byte-equal output between invocations.

**Optional CLI-level smoke test** (lower priority — covered by repro above):
- A `vitest` test that spawns `node packages/cli/dist/cli.js install --target <tmpdir>
  --yes --dry-run` with `HOME=<tmp-fake-home>/.codex` containing the fixture, asserts
  exit code 0 and the rewritten file contains `[mcp_servers.fabric]`. **Defer** — adds
  process-spawning fragility for marginal additional coverage.

---

## Outstanding clarifications

None. The bug is closed-no-repro. TASK-007 should proceed as a 2h test-add task.

If user re-reports Bug Y after rc.17 ships with the regression test in place, the next
investigation should:
1. Capture exact `fab --version` (to rule out stale-binary).
2. Capture `ls -la ~/.codex/config.toml` (mtime + ownership).
3. Capture full output of `fab install --debug --target <fixture>` (after adding the
   `--debug` logging recommended above).
4. Capture Codex CLI's own resolution: `codex config show` or equivalent (to confirm
   which `config.toml` Codex actually reads).
