# F-001 — Install Stage Refactor

> Role: system-architect | Related decisions: SA-01

## Architecture

The current install.ts (2025 lines) MUST decompose into 7 discrete stages with explicit scope boundaries. The refactoring MUST preserve existing behavior while enabling per-stage testing and granular error recovery.

### Current State (6 stages)

Analysis of `packages/cli/src/commands/install.ts` reveals the following existing stages:

1. **preflight** — Target validation, serve-lock check (removed in rc.37)
2. **scaffold** — Create `.fabric/` directory, events.jsonl, forensic.json, fabric-config.json
3. **bootstrap** — Install skills (archive/review/import/sync/store/audit/connect), hook scripts, hook configs, bootstrap snapshots
4. **mcp** — MCP client configuration (Claude Code, Codex, Cursor)
5. **hooks** — Hook installation (delegated to installHooks in hooks-orchestrator.ts)
6. **post-setup** — Store onboarding, semantic search prompt, restart banner

### Target State (7 stages)

The refactoring MUST introduce two new stages:

1. **preflight** — Target validation, write permissions check, TTY detection
2. **global-setup** — Ensure `~/.fabric` exists with uid + personal store (currently inlined in runInitCommand lines 379-382)
3. **scaffold** — Unchanged from current
4. **store-onboarding** — Extract from post-setup; interactive store wizard (UX-01)
5. **bootstrap** — Unchanged from current
6. **mcp** — Unchanged from current
7. **hooks** — Unchanged from current

The **post-setup** stage MUST be eliminated; its responsibilities MUST move to store-onboarding and the final summary card (UI-02).

### Module Layout

```
packages/cli/src/
├── commands/
│   └── install.ts              # Orchestrator only (plan → execute → report)
├── install/
│   ├── stages/
│   │   ├── preflight.ts        # PreflightStage
│   │   ├── global-setup.ts     # GlobalSetupStage
│   │   ├── scaffold.ts         # ScaffoldStage (extract from buildInitFabricPlan)
│   │   ├── store-onboarding.ts # StoreOnboardingStage (new)
│   │   ├── bootstrap.ts        # BootstrapStage (extract executeInitStagePlan case)
│   │   ├── mcp.ts              # McpStage (extract executeInitStagePlan case)
│   │   └── hooks.ts            # HooksStage (wrap installHooks)
│   ├── stage-registry.ts       # Stage registration and ordering
│   ├── stage-executor.ts       # executeStages(plan, renderer)
│   └── stage-types.ts          # InstallStage, StageResult, StageName
```

The `install/stages/` directory MUST contain one file per stage. Each stage MUST export a class implementing the `InstallStage` interface:

```typescript
export interface InstallStage {
  name: StageName;
  idempotent: boolean;
  failureMode: 'graceful' | 'hard-fail';
  prerequisites: StageName[];
  
  validate(input: InstallStageInput): Promise<boolean>;
  execute(input: InstallStageInput, renderer: OutputRenderer): Promise<StageResult>;
  rollback(input: InstallStageInput): Promise<void>;
}
```

The `stage-registry.ts` MUST define the canonical stage ordering:

```typescript
export const INSTALL_STAGE_ORDER: StageName[] = [
  'preflight',
  'global-setup',
  'scaffold',
  'store-onboarding',
  'bootstrap',
  'mcp',
  'hooks',
];
```

## Interface Contract

### InstallStageInput

```typescript
export type InstallStageInput = {
  target: string;
  options: InitOptions;
  globalRoot: string;
  fabricDir: string;
  supports: DetectedClientSupport[];
  previousResults: Map<StageName, StageResult>;
};
```

### StageResult

```typescript
export type StageResult = {
  disposition: 'ran' | 'skipped' | 'failed';
  filesWritten: string[];
  filesSkipped: string[];
  errors: StageError[];
  durationMs: number;
};

export type StageError = {
  step: string;
  path: string;
  message: string;
  recoverable: boolean;
};
```

### InstallStage Interface

The `InstallStage` interface MUST define the following methods:

| Method | Return Type | Description |
|--------|-------------|-------------|
| `validate(input)` | `Promise<boolean>` | Check prerequisites; return false if stage should be skipped |
| `execute(input, renderer)` | `Promise<StageResult>` | Execute stage logic; MUST use renderer for all output |
| `rollback(input)` | `Promise<void>` | Clean partial state; called on hard-fail recovery |

### Consumers

- **install.ts orchestrator** — Iterates stages, calls validate/execute, handles disposition
- **doctor --fix** — Re-runs failed stages individually
- **Test harness** — Mocks individual stages for unit testing

## Constraints (RFC 2119)

1. **Idempotency** — Each stage MUST be safe to re-run. The execute method MUST detect existing artifacts and skip writing when content matches canonical state (see diff-mode logic in buildInitFabricPlan).

2. **Global-layer separation** — The global-setup stage MUST run before scaffold. It MUST ensure `~/.fabric` exists with valid uid and personal store. This stage MUST be a no-op when global config already exists.

3. **Store-onboarding interactivity** — The store-onboarding stage MUST be skipped in non-interactive mode (no TTY or `--yes` flag). When skipped, it MUST NOT bind any store.

4. **Context detection** — The preflight stage SHOULD detect: (a) fresh machine (no global config), (b) existing global (uid present), (c) project already installed (events.jsonl exists). This information MUST be surfaced to the wizard.

5. **Failure mode compliance** — Stages MUST declare `failureMode: 'hard-fail'` only when a failure MUST abort the entire install. All other stages MUST use `'graceful'` and continue.

6. **Event emission** — Each stage MUST emit `install_stage_completed` to events.jsonl. The event MUST include `disposition`, `files_written`, `errors`, and `duration_ms`.

7. **OutputRenderer usage** — Stages MUST NOT call console.log, console.error, or process.stderr.write directly. All output MUST go through the provided `OutputRenderer` instance.

## Test Approach

### Unit Tests

Each stage MUST have a dedicated test file under `tests/install/stages/`:

```
tests/install/stages/
├── preflight.test.ts
├── global-setup.test.ts
├── scaffold.test.ts
├── store-onboarding.test.ts
├── bootstrap.test.ts
├── mcp.test.ts
└── hooks.test.ts
```

Test MUST verify:

1. **Idempotency** — Run stage twice on same input; assert no diff in output
2. **Failure mode** — Inject error; assert graceful stages continue, hard-fail stages abort
3. **Prerequisites** — Call validate with missing prerequisites; assert false
4. **Rollback** — Interrupt stage mid-execution; call rollback; assert clean state

### Integration Tests

`tests/install/install-pipeline.test.ts` MUST verify:

1. **Full pipeline** — Run install on fresh directory; assert all 7 stages executed
2. **Re-run idempotency** — Run install twice; assert second run skips all stages
3. **Partial recovery** — Interrupt at stage 4; run install; assert stages 4-7 execute
4. **Concurrent safety** — Run install in two parallel processes; assert no corruption

### Mock Strategy

Tests MUST mock:

- `atomicWriteJson` — Capture written files without touching disk
- `detectClientSupports` — Control which clients are detected
- `buildForensicReport` — Avoid expensive tree-sitter parsing
- `OutputRenderer` — Assert render calls without TTY dependency

## TODOs

1. **Extract global-setup from runInitCommand** — Lines 379-382 in install.ts currently mint global config; move to new `global-setup.ts` stage.

2. **Extract store-onboarding from post-setup** — Lines 425-432 (bindRemoteStoreToProject) and 427-432 (promptStoreOnboarding) MUST move to new `store-onboarding.ts` stage.

3. **Define StageName union type** — Replace `InitStageName = "bootstrap" | "mcp" | "hooks"` with 7-element union.

4. **Implement stage-executor.ts** — Create `executeStages(plan, renderer)` that iterates stages, handles disposition, and aggregates results.

5. **Migrate existing stage logic** — Move scaffold logic from `buildInitFabricPlan`/`executeInitFabricPlan` to `scaffold.ts`. Move bootstrap/mcp/hooks logic from `executeInitStagePlan` to respective stage files.

6. **Update uninstall symmetry** — Once install refactoring complete, update uninstall.ts to mirror 7 stages in reverse order (see F-004).