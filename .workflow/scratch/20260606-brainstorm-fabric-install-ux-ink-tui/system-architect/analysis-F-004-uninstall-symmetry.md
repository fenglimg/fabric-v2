# F-004 — Uninstall Symmetry

> Role: system-architect | Related decisions: SA-03

## Architecture

The uninstall command MUST mirror install with symmetric stage ordering in reverse. The current uninstall.ts lacks store-binding cleanup, leaving orphan entries in the global registry.

### Current State (3 stages)

Analysis of `packages/cli/src/commands/uninstall.ts` reveals the following existing stages:

1. **scaffold** — Remove `.fabric/agents.meta.json`, `.fabric/events.jsonl`, `.fabric/forensic.json`, and `.gitkeep` markers
2. **bootstrap** — Remove skills, hook scripts, hook configs, bootstrap pointers
3. **mcp** — Remove MCP client configurations

The **knowledge preservation invariant** is enforced: `.fabric/knowledge/` contents are never removed (lines 39-42, 316-318).

### Gap: Missing Store-Binding Cleanup

The current uninstall does NOT clean:

1. **Project store binding** — `.fabric/fabric-config.json` contains `active_write_store` field that persists after uninstall
2. **Global store registry** — `~/.fabric/stores/<uuid>/` remains mounted even when no project references it
3. **Bindings snapshot** — `.fabric/bindings.json` persists, referencing unmounted stores

This leaves orphan entries that cause confusion when the user re-installs or runs `fabric doctor`.

### Target State (7 stages, reverse order)

The refactoring MUST add 4 new stages:

1. **hooks** — Remove hook configs (reverse of install hooks stage)
2. **mcp** — Remove MCP configs (reverse of install mcp stage)
3. **bootstrap** — Remove skills and bootstrap pointers (reverse of install bootstrap stage)
4. **store-binding-cleanup** — NEW: Clean store bindings and optionally unmount
5. **scaffold** — Remove `.fabric/` state files (reverse of install scaffold stage)
6. **global-cleanup** — NEW: Optionally remove global config if no stores remain
7. **postflight** — NEW: Verify cleanup completeness, emit summary

The **store-binding-cleanup** stage MUST:

- Read project's `.fabric/fabric-config.json` for `active_write_store`
- Remove `active_write_store` field from config
- Remove project's `.fabric/bindings.json`
- Check global registry for other projects bound to same store
- Prompt user: "Unmount store '<alias>'? (no other projects use it)" [Y/n]
- If user consents, remove `~/.fabric/stores/<uuid>/` entry

The **global-cleanup** stage MUST:

- Check `~/.fabric/stores/` for remaining mounted stores
- Check `~/.fabric/uid` existence
- Prompt user: "Remove global Fabric config? (no stores mounted)" [Y/n]
- If user consents, remove `~/.fabric/uid`, `~/.fabric/config.json`, `~/.fabric/stores/`

### Module Layout

```
packages/cli/src/
├── commands/
│   └── uninstall.ts            # Orchestrator only
├── uninstall/
│   ├── stages/
│   │   ├── hooks.ts            # HooksCleanupStage
│   │   ├── mcp.ts              # McpCleanupStage
│   │   ├── bootstrap.ts        # BootstrapCleanupStage (existing uninstallBootstrapStage)
│   │   ├── store-binding-cleanup.ts  # NEW: StoreBindingCleanupStage
│   │   ├── scaffold.ts         # ScaffoldCleanupStage (existing executeUninstallFabricPlan)
│   │   ├── global-cleanup.ts   # NEW: GlobalCleanupStage
│   │   └── postflight.ts       # NEW: PostflightStage
│   └── stage-registry.ts       # Reverse ordering
```

## Interface Contract

### UninstallStage (Mirrors InstallStage)

```typescript
export interface UninstallStage {
  name: UninstallStageName;
  idempotent: boolean;
  failureMode: 'graceful' | 'hard-fail';
  prerequisites: UninstallStageName[];
  
  validate(input: UninstallStageInput): Promise<boolean>;
  execute(input: UninstallStageInput, renderer: OutputRenderer): Promise<StageResult>;
  rollback(input: UninstallStageInput): Promise<void>;
}
```

### UninstallStageInput

```typescript
export type UninstallStageInput = {
  target: string;
  options: UninstallOptions;
  globalRoot: string;
  fabricDir: string;
  previousResults: Map<UninstallStageName, StageResult>;
};
```

### StoreBindingCleanupContract

The `store-binding-cleanup.ts` stage MUST implement:

```typescript
export type StoreBindingCleanupResult = {
  bindingRemoved: boolean;
  storeUnmounted: boolean;
  storeAlias?: string;
};

export class StoreBindingCleanupStage implements UninstallStage {
  name = 'store-binding-cleanup' as const;
  idempotent = true;
  failureMode = 'graceful';
  
  async execute(input: UninstallStageInput, renderer: OutputRenderer): Promise<StageResult & StoreBindingCleanupResult> {
    // Implementation...
  }
}
```

### Consumers

- **uninstall.ts orchestrator** — Iterates stages in reverse order
- **doctor --fix orphan-stores** — Re-runs store-binding-cleanup on detected orphans
- **Test harness** — Mocks store operations for unit testing

## Constraints (RFC 2119)

1. **Mirror install in reverse** — Uninstall MUST execute stages in reverse order: hooks → mcp → bootstrap → store-binding-cleanup → scaffold → global-cleanup → postflight.

2. **Knowledge preservation (E4 protocol)** — Uninstall MUST NEVER remove `.fabric/knowledge/` directory contents. The scaffold stage MUST explicitly skip this path (existing behavior, lines 316-318).

3. **Prompt before unmount** — The store-binding-cleanup stage MUST prompt user before unmounting a store. The prompt MUST only appear when no other projects reference the store.

4. **Rollback path** — The user MUST be able to recover from uninstall by running `fabric install`. All removed artifacts MUST be re-created.

5. **Graceful failure** — The store-binding-cleanup stage MUST use `failureMode: 'graceful'`. If store registry is corrupted, the stage MUST log error and continue.

6. **Idempotency** — Re-running uninstall MUST be safe. The validate method MUST detect already-cleaned artifacts and skip.

7. **Event emission** — Each stage MUST emit `uninstall_stage_completed` to events.jsonl (if still exists) or console log.

8. **Personal root guard** — The existing `isInsidePersonalRoot` guard (lines 839-848) MUST remain active. Uninstall MUST never touch `~/.fabric/knowledge/`.

## Test Approach

### Unit Tests

Each new stage MUST have dedicated tests:

```
tests/uninstall/stages/
├── store-binding-cleanup.test.ts
├── global-cleanup.test.ts
└── postflight.test.ts
```

Tests MUST verify:

1. **Store unmount prompt** — Mock store registry with single bound project; assert prompt appears
2. **Skip unmount when multiple bindings** — Mock store with 2 bound projects; assert no prompt
3. **Knowledge preservation** — Attempt to remove `.fabric/knowledge/`; assert guard blocks
4. **Personal root guard** — Attempt to remove `~/.fabric/knowledge/`; assert guard blocks

### Integration Tests

`tests/uninstall/uninstall-pipeline.test.ts` MUST verify:

1. **Full uninstall** — Run install then uninstall; assert all artifacts removed except knowledge
2. **Rollback recovery** — Run install → uninstall → install; assert identical state to fresh install
3. **Orphan store cleanup** — Install with store bind → uninstall → doctor; assert no orphan lint
4. **Partial uninstall** — Interrupt at store-binding-cleanup; resume; assert completion

### Mock Strategy

Tests MUST mock:

- `storeList` — Control mounted stores without touching ~/.fabric
- `loadProjectConfig` — Simulate active_write_store presence/absence
- `OutputRenderer` — Assert prompt calls without TTY

## TODOs

1. **Implement store-binding-cleanup stage** — Create `uninstall/stages/store-binding-cleanup.ts` with store unmount logic.

2. **Implement global-cleanup stage** — Create `uninstall/stages/global-cleanup.ts` with ~/.fabric removal logic.

3. **Implement postflight stage** — Create `uninstall/stages/postflight.ts` with verification and summary.

4. **Update uninstall orchestrator** — Modify `executeUninstallExecutionPlan` to iterate 7 stages in reverse order.

5. **Add unmount prompt** — Implement renderer.confirm() call in store-binding-cleanup for store unmount decision.

6. **Update doctor orphan detection** — Add lint rule that detects orphan stores and suggests store-binding-cleanup.

7. **E2E test: install → uninstall → install** — Verify rollback path produces identical state.

8. **Document store preservation policy** — Update AGENTS.md to clarify that uninstall preserves knowledge but may unmount stores.