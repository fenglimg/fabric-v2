# rc.17 R-diagnose — Target Resolution Chain

**Task**: TASK-003 (read-only). Map every reader of `externalFixturePath`
(config field — to be **dropped**), `EXTERNAL_FIXTURE_PATH` (env var — to be
**preserved**), and the `--target` CLI flag, so TASK-004's deletion is
mechanical.

**Verify command** (re-runnable):

```bash
grep -rn 'externalFixturePath' packages/ --include='*.ts' | grep -v dist | grep -v coverage
grep -rn 'EXTERNAL_FIXTURE_PATH' packages/ --include='*.ts' | grep -v dist | grep -v coverage
```

---

## 1. Schema definition site

**File**: `packages/shared/src/schemas/fabric-config.ts:50`

```ts
export const fabricConfigSchema = z.object({
  clientPaths: clientPathsSchema.optional(),
  externalFixturePath: z.string().optional(),   // <-- line 50, the target to delete
  scanIgnores: z.array(z.string()).optional(),
  ...
});
```

Shape: `z.string().optional()`. No default. No preprocess/alias. No comment.

**Mirror in TypeScript interface**: `packages/shared/src/types/config.ts:30`

```ts
export interface FabricConfig {
  clientPaths?: ClientPaths;
  externalFixturePath?: string;   // <-- line 30, mirrors the schema
  scanIgnores?: string[];
  ...
}
```

(The interface in `types/config.ts` is hand-maintained and partial — see
`fabric-config-introspect.ts:37-40` comment confirming the schema is the
source of truth via `z.infer`.)

---

## 2. All reader sites

### 2a. Production code readers of `config.externalFixturePath`

| # | File:line | Context |
|---|-----------|---------|
| 1 | `packages/cli/src/dev-mode.ts:33` | `const configTarget = normalizeTarget(fabricConfig.externalFixturePath, workspaceRoot);` |
| 2 | `packages/cli/src/dev-mode.ts:39` | `formatResolutionStep("fabric.config.json.externalFixturePath", configTarget),` (chain breadcrumb only) |
| 3 | `packages/cli/src/dev-mode.ts:51-53` | `if (configTarget !== undefined) { return { target: configTarget, source: "config", chain }; }` |

**That is the ONLY production reader.** `packages/cli/src/config/resolver.ts`
(referenced in TASK-003 spec) does **NOT** read `externalFixturePath` — it
reads `fabricConfig.clientPaths` only. The task spec's hypothesis ("initial
scan suggests it does NOT — confirm") is confirmed: zero readers in
`resolver.ts`.

Surrounding ~5 lines of `dev-mode.ts:30-56` (the only place that matters):

```ts
export function resolveDevMode(cliTarget?: string, workspaceRoot: string = process.cwd()): DevModeResolution {
  const envTarget = normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH, workspaceRoot);
  const fabricConfig = readFabricConfig(workspaceRoot);
  const configTarget = normalizeTarget(fabricConfig.externalFixturePath, workspaceRoot);  // <-- DELETE
  const directTarget = normalizeTarget(cliTarget, workspaceRoot);

  const chain = [
    formatResolutionStep("cliTarget", directTarget),
    formatResolutionStep("EXTERNAL_FIXTURE_PATH", envTarget),
    formatResolutionStep("fabric.config.json.externalFixturePath", configTarget),  // <-- DELETE
    formatResolutionStep("process.cwd()", workspaceRoot),
  ];

  if (directTarget !== undefined) return { target: directTarget, source: "cli", chain };
  if (envTarget !== undefined)    return { target: envTarget,    source: "env", chain };
  if (configTarget !== undefined) return { target: configTarget, source: "config", chain };  // <-- DELETE
  return { target: workspaceRoot, source: "cwd", chain };
}
```

### 2b. Production code readers of `process.env.EXTERNAL_FIXTURE_PATH` (PRESERVED)

| # | File:line | Context |
|---|-----------|---------|
| 1 | `packages/cli/src/dev-mode.ts:31` | `const envTarget = normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH, workspaceRoot);` |
| 2 | `packages/cli/src/dev-mode.ts:38` | `formatResolutionStep("EXTERNAL_FIXTURE_PATH", envTarget),` (breadcrumb) |
| 3 | `packages/cli/src/dev-mode.ts:63` | `return normalizeTarget(cliTarget) !== undefined || normalizeTarget(process.env.EXTERNAL_FIXTURE_PATH) !== undefined;` (in `isDevMode()`) |

Out of scope for TASK-004 — env var stays.

### 2c. `resolveDevMode` / `isDevMode` callers (downstream of the chain)

These do NOT touch `externalFixturePath` directly but consume the resolution.
Listed for completeness — TASK-004 should NOT modify these:

| File:line | Caller |
|-----------|--------|
| `packages/cli/src/commands/install.ts:14, 313` | `resolveDevMode(args.target, process.cwd())` |
| `packages/cli/src/commands/uninstall.ts:11, 205` | `resolveDevMode(args.target, process.cwd())` |
| `packages/cli/src/commands/serve.ts:6, 48` | `resolveDevMode(args.target, workspaceRoot)` |
| `packages/cli/src/commands/doctor.ts:16, 112` | `resolveDevMode(args.target, workspaceRoot)` |
| `packages/cli/src/commands/plan-context-hint.ts:5, 137` | `resolveDevMode(opts.target, process.cwd())` |

### 2d. Type / introspection references

| # | File:line | Context |
|---|-----------|---------|
| 1 | `packages/shared/src/types/config.ts:30` | `externalFixturePath?: string;` (interface mirror — DELETE) |
| 2 | `packages/shared/src/schemas/fabric-config-introspect.ts:34` | Comment listing schema fields out of panel scope: `// (clientPaths, externalFixturePath, scanIgnores, mcpPayloadLimits)` — UPDATE comment to drop the name |

---

## 3. Test fixture sites

| # | File:line | Fixture context | Action |
|---|-----------|-----------------|--------|
| 1 | `packages/shared/test/fabric-config.test.ts:106` | `externalFixturePath: "/tmp/fixtures",` inside `previousVersionFixture` literal | Delete the line |
| 2 | `packages/shared/test/fabric-config.test.ts:115` | `expect(parsed.externalFixturePath).toBe("/tmp/fixtures");` | Delete the line |
| 3 | `packages/shared/test/integration/schemas-roundtrip.test.ts:50` | `externalFixturePath: '/fixtures',` inside `roundTrip(fabricConfigSchema, {...})` | Delete the line |
| 4 | `packages/shared/test/property-based/zod-roundtrip.test.ts:47` | `externalFixturePath: fc.string(),` inside `fabricConfigArbitrary` record | Delete the line |

All four sites are simple line deletions — no surrounding logic changes.
The `previousVersionFixture` test (`fabric-config.test.ts:98-126`) is
specifically a "still parses pre-rc fixture" regression test; once the field
is removed from the schema, the fixture must drop it too (a v2.0-rc.1 user
who set `externalFixturePath` will hit a Zod `Unrecognized key` error per
the rc.12 hard-rename precedent — acceptable under the zero-user
clean-slate policy).

---

## 4. Current resolution chain

Implementation: `packages/cli/src/dev-mode.ts:30-56` (`resolveDevMode`).

**Order of precedence (highest → lowest)**:

1. `--target` CLI flag (per-command arg → `cliTarget` parameter) → `source: "cli"`
2. `EXTERNAL_FIXTURE_PATH` env var → `source: "env"`
3. `fabric.config.json#externalFixturePath` field → `source: "config"` ← **TO REMOVE**
4. `process.cwd()` (or explicit `workspaceRoot` param) → `source: "cwd"`

Each step normalizes via `normalizeTarget()` (trim, abs-path resolution).
`undefined`/empty-string sources are skipped. The full chain is always
recorded in the `DevModeResolution.chain` breadcrumb (for `--debug` output).

**Post-TASK-004 chain** (3 sources, not 4):

1. `--target` → `"cli"`
2. `EXTERNAL_FIXTURE_PATH` → `"env"`
3. `process.cwd()` → `"cwd"`

`DevModeSource` union (`packages/cli/src/dev-mode.ts:6`) shrinks from
`"cli" | "env" | "config" | "cwd"` to `"cli" | "env" | "cwd"`. No external
consumers of the `"config"` literal — `resolution.source` is only ever
formatted into debug output via `chain` (not pattern-matched).

---

## 5. Cut plan for TASK-004

Edit in this dependency order. Each bullet is a discrete edit; the whole
set is one commit (per rc.17 `each task = one git commit`).

### Step A — Schema (source of truth)

1. **`packages/shared/src/schemas/fabric-config.ts`**
   - Delete line 50: `externalFixturePath: z.string().optional(),`

### Step B — Type mirror

2. **`packages/shared/src/types/config.ts`**
   - Delete line 30: `externalFixturePath?: string;`

### Step C — Production reader (the only one)

3. **`packages/cli/src/dev-mode.ts`**
   - Delete line 33: `const configTarget = normalizeTarget(fabricConfig.externalFixturePath, workspaceRoot);`
   - Delete line 39: `formatResolutionStep("fabric.config.json.externalFixturePath", configTarget),`
   - Delete lines 51-53 (the `if (configTarget !== undefined)` branch)
   - Narrow `DevModeSource` (line 6): drop `"config"` from the union →
     `export type DevModeSource = "cli" | "env" | "cwd";`
   - **Optional cleanup**: `readFabricConfig()` (lines 16-28) becomes dead
     code in `dev-mode.ts` after the cut. Audit other callers — if none, remove
     it too. (Quick grep: `grep -rn 'readFabricConfig' packages/ --include='*.ts'`
     before deletion.)

### Step D — Tests (line deletions only)

4. **`packages/shared/test/fabric-config.test.ts`**
   - Delete line 106: `externalFixturePath: "/tmp/fixtures",`
   - Delete line 115: `expect(parsed.externalFixturePath).toBe("/tmp/fixtures");`

5. **`packages/shared/test/integration/schemas-roundtrip.test.ts`**
   - Delete line 50: `externalFixturePath: '/fixtures',`

6. **`packages/shared/test/property-based/zod-roundtrip.test.ts`**
   - Delete line 47: `externalFixturePath: fc.string(),`

### Step E — Comments / docs

7. **`packages/shared/src/schemas/fabric-config-introspect.ts:34`**
   - Update the panel-scope comment listing Group E plumbing fields:
     remove `externalFixturePath` from the parenthesized list →
     `// (clientPaths, scanIgnores, mcpPayloadLimits)`

8. **`docs/configuration.md:282-285`**
   - Delete the `### externalFixturePath` section (4 lines).
   - Optional: add a one-line mention under a "Test/dev fixture" note that
     `EXTERNAL_FIXTURE_PATH` env var is the supported override (keeps
     parity with the i18n description "defaults to … `EXTERNAL_FIXTURE_PATH`,
     fabric.config.json, then cwd" — note that i18n strings should ALSO be
     updated to drop the `fabric.config.json` reference since the chain is
     now 3-step, not 4-step. See Risk Flag #2).

### i18n (NOTE — borderline; flag for TASK-004 implementer)

The i18n key `cli.*.args.target.description` currently reads (en):

> "Target project path. Defaults to CLI arg, EXTERNAL_FIXTURE_PATH,
> fabric.config.json, then cwd."

After TASK-004 the `fabric.config.json` token is misleading (no config
field is consulted anymore). The 7 affected en + zh-CN keys live at:

- `packages/shared/src/i18n/locales/en.ts:127, 160, 262, 313, 318, 352, 363`
- `packages/shared/src/i18n/locales/zh-CN.ts:125, 157, 257, 307, 312, 343, 353`

Plus the corresponding 4 lines in `packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap:78, 126, 183, 222` (auto-regenerates on `vitest -u` once the i18n strings change).

Recommendation: **include the i18n rewrite in TASK-004** — otherwise help
text lies. The task spec says "i18n descriptions referencing it remain
unchanged" but that comment was specifically about the env var name
(`EXTERNAL_FIXTURE_PATH`); the misleading phrase is `fabric.config.json`,
not the env var. New string suggestion:
`"Target project path. Defaults to CLI arg, EXTERNAL_FIXTURE_PATH, then cwd."`

---

## 6. Risk flags

### Risk #1 — `readFabricConfig` may have other callers

`dev-mode.ts:16-28` exports `readFabricConfig`. After the cut, it becomes
unused inside `dev-mode.ts`. **Action for TASK-004**: run
`grep -rn 'readFabricConfig' packages/ --include='*.ts'` before/after the
edit; if the only remaining reference is the export itself, remove it too
(or leave it — pure-additive shim, but per clean-slate preference it
should be removed if dead).

### Risk #2 — i18n drift (medium)

Six command help texts (`doctor`, `install`, `uninstall`, `scan`, `serve`,
`update`) advertise `fabric.config.json` as a fallback in the resolution
chain. Post-cut, that's a lie. The cli-surface snapshot test
(`cli-surface.test.ts.snap`) will pick up any i18n change automatically
via `vitest -u`. **The TASK-003 spec underestimates this**: the task spec
said i18n stays unchanged, but it referred only to the env var token. The
`fabric.config.json` substring needs to go from 13 i18n strings (7 en + 6
zh-CN — `pre-commit` is shorter) and 4 snapshot blocks. See Section 5
Step E for the concrete list. Suggest folding into TASK-004 to avoid a
trailing follow-up commit.

### Risk #3 — Pre-existing `previousVersionFixture` semantic shift (low)

`fabric-config.test.ts:98-126` is named "previous-version fixture still
parses". After dropping `externalFixturePath`, the fixture is no longer a
faithful snapshot of v2.0-rc.1 — but per the rc.12 hard-rename precedent
(no preprocess shim), this is acceptable. The test name could optionally
be tightened ("v2.0-rc-shaped fixture without externalFixturePath") but
this is cosmetic; the current name remains accurate as long as no caller
expects the field to round-trip.

### Risk #4 — No CI/integration tests reference the field for fixture wiring

Searched `packages/cli/__tests__/` for any test that writes a
`fabric.config.json` containing `externalFixturePath` to drive integration
fixtures — **none found**. Integration tests rely on the
`EXTERNAL_FIXTURE_PATH` env var path (covered by `dev-mode.ts:31, 63`),
not the config field. So removing the field will NOT break any fixture
plumbing in CI. ✅ Clean.

### Risk #5 — No production-code dependency on `DevModeSource === "config"`

Searched `packages/` for any consumer that pattern-matches
`resolution.source === "config"`. **None found** — `source` is only
read into the `chain` breadcrumb (debug logging) by the five command
files (install/uninstall/serve/doctor/plan-context-hint). Narrowing the
union from 4 to 3 variants is safe. ✅ Clean.

---

## Summary stats (for return value)

- **Production reader sites of `externalFixturePath` (the field)**: **3** (all in `dev-mode.ts:33, 39, 51-53`)
- **Type mirror site**: **1** (`types/config.ts:30`)
- **Schema definition site**: **1** (`fabric-config.ts:50`)
- **Test fixture sites**: **4** (across 3 test files)
- **Comment / doc sites needing touch-up**: **2** (introspect.ts:34, configuration.md:282-285)
- **i18n drift surface (borderline scope)**: **13 i18n strings + 4 snapshot lines** referencing the misleading `fabric.config.json` substring
- **Risk flags**: **5** total — 1 medium (i18n drift, recommend folding into TASK-004), 4 low/clean
