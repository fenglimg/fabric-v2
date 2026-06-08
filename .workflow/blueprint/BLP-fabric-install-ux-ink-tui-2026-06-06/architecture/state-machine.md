# Install Flow State Machine

## Overview

The install/uninstall flow is governed by a state machine to ensure:
- Explicit transitions with clear triggers
- Resumable state for future recovery features
- Visualizable flow for debugging
- Testable state transitions

## ASCII State Diagram

```
                    INSTALL PIPELINE
                    
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   [INIT] ──▶ PREFLIGHT ──▶ ENV_DETECT ──▶ STORE_CONFIG         │
│      │           │             │             │                  │
│      │           │             │             │                  │
│   (start)    (checks      (detect       (wizard              │
│              passed)       clients)      complete)            │
│      │           │             │             │                  │
│      │           ▼             ▼             ▼                  │
│      │       [ERROR]       [ERROR]       [ERROR]                │
│      │           │             │             │                  │
│      │       (abort)        (abort)       (abort)               │
│      │           │             │             │                  │
│                                                                 │
│                     STORE_CONFIG                                │
│                          │                                      │
│                          ▼                                      │
│                    HOOK_INSTALL ──▶ MCP_REGISTER               │
│                          │              │                       │
│                          ▼              ▼                       │
│                     [DEGRADED]    [DEGRADED]                   │
│                          │              │                       │
│                          ▼              ▼                       │
│                    VALIDATION ──▶ GUIDANCE ──▶ [COMPLETE]      │
│                          │              │                       │
│                          ▼              │                       │
│                     [ERROR]             │                       │
│                          │              │                       │
│                      (rollback)         │                       │
│                          │              │                       │
│                          ▼              ▼                       │
│                      [ABORT] ───────▶ [ROLLBACK]               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

                    UNINSTALL PIPELINE
                    
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   [INIT] ──▶ PRE_UNFLIGHT ──▶ STORE_CLEANUP ──▶ HOOK_REMOVE    │
│      │           │                 │               │            │
│      │           │                 │               │            │
│   (start)    (confirmed)       (binding         (hooks         │
│              by user)          removed)         removed)       │
│      │           │                 │               │            │
│      │           ▼                 ▼               ▼            │
│      │       [CANCELLED]       [ERROR]         [ERROR]          │
│      │           │                 │               │            │
│      │       (abort)            (abort)         (abort)         │
│      │           │                 │               │            │
│                                                                 │
│                     HOOK_REMOVE                                 │
│                          │                                      │
│                          ▼                                      │
│                   MCP_DEREGISTER ──▶ VALIDATION                 │
│                          │              │                       │
│                          ▼              ▼                       │
│                     [DEGRADED]    [SUCCESS]                     │
│                          │              │                       │
│                          ▼              ▼                       │
│                     [COMPLETE] ──▶ [DONE]                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## State Definitions

### Install States

| State | Description | Entry Action | Exit Action |
|-------|-------------|--------------|-------------|
| `INIT` | Initial state, parse CLI args | Load config, create state object | Emit `install:start` |
| `PREFLIGHT` | Run preflight checks | Execute checks | Log check results |
| `ENV_DETECT` | Detect client environments | Scan for clients | Store detected clients |
| `STORE_CONFIG` | Interactive wizard or auto-config | Start wizard | Persist store config |
| `HOOK_INSTALL` | Install hooks to clients | Copy hook templates | Log installed hooks |
| `MCP_REGISTER` | Register MCP in client configs | Modify config files | Backup configs |
| `VALIDATION` | Verify installation | Run validation checks | Emit validation result |
| `GUIDANCE` | Show post-setup guidance | Render summary card | Emit `install:complete` |
| `COMPLETE` | Success terminal state | Emit metrics | N/A |
| `ERROR` | Permanent error state | Log error, show message | N/A |
| `DEGRADED` | Non-critical error, continue | Log warning | Continue to next stage |
| `ABORT` | Abort with rollback | Execute rollback | Emit `install:abort` |
| `ROLLBACK` | Rollback in progress | Restore backups | Emit `install:rollback` |

### Uninstall States

| State | Description | Entry Action | Exit Action |
|-------|-------------|--------------|-------------|
| `INIT` | Initial state | Load install state | Emit `uninstall:start` |
| `PRE_UNFLIGHT` | Confirm with user | Show confirmation | Emit `uninstall:confirmed` |
| `STORE_CLEANUP` | Remove store binding | Delete binding file | Log cleanup |
| `HOOK_REMOVE` | Remove hooks | Delete hook files | Log removed hooks |
| `MCP_DEREGISTER` | Remove MCP configs | Modify config files | Restore from backup if needed |
| `VALIDATION` | Verify uninstall | Run validation checks | Emit validation result |
| `COMPLETE` | Success terminal state | Show summary | Emit `uninstall:complete` |
| `CANCELLED` | User cancelled | Show cancellation | Emit `uninstall:cancelled` |
| `ERROR` | Permanent error | Log error | N/A |
| `DEGRADED` | Non-critical error | Log warning | Continue |

## Transition Table

### Install Transitions

| From | To | Trigger | Guard Condition | Action |
|------|----|---------|-----------------|---------|
| `INIT` | `PREFLIGHT` | `START` | Args parsed | Begin checks |
| `PREFLIGHT` | `ENV_DETECT` | `CHECKS_PASSED` | All checks passed | Start detection |
| `PREFLIGHT` | `ERROR` | `CHECKS_FAILED` | Permanent check failed | Show error, abort |
| `ENV_DETECT` | `STORE_CONFIG` | `CLIENTS_FOUND` | At least 1 client | Start wizard |
| `ENV_DETECT` | `STORE_CONFIG` | `NO_CLIENTS` | No clients detected | Show manual selection |
| `STORE_CONFIG` | `HOOK_INSTALL` | `STORE_READY` | Store config complete | Begin hook install |
| `STORE_CONFIG` | `ERROR` | `STORE_FAILED` | Invalid store config | Show error, abort |
| `HOOK_INSTALL` | `MCP_REGISTER` | `HOOKS_OK` | All hooks installed | Begin MCP registration |
| `HOOK_INSTALL` | `MCP_REGISTER` | `HOOKS_DEGRADED` | Some hooks failed (warning) | Continue with warning |
| `HOOK_INSTALL` | `ERROR` | `HOOKS_FAILED` | All hooks failed | Abort with rollback |
| `MCP_REGISTER` | `VALIDATION` | `MCP_OK` | All MCP registered | Begin validation |
| `MCP_REGISTER` | `VALIDATION` | `MCP_DEGRADED` | Some MCP failed | Continue with warning |
| `MCP_REGISTER` | `ERROR` | `MCP_FAILED` | All MCP failed | Abort with rollback |
| `VALIDATION` | `GUIDANCE` | `VALID_OK` | All validation passed | Show guidance |
| `VALIDATION` | `GUIDANCE` | `VALID_WARNINGS` | Non-critical warnings | Show guidance with warnings |
| `VALIDATION` | `ERROR` | `VALID_FAILED` | Critical validation failed | Abort with rollback |
| `GUIDANCE` | `COMPLETE` | `GUIDANCE_DONE` | Summary displayed | Emit metrics |
| `ERROR` | `ABORT` | `ABORT_REQUESTED` | Error confirmed | Begin rollback |
| `ABORT` | `ROLLBACK` | `ROLLBACK_START` | Rollback initiated | Execute rollback actions |
| `ROLLBACK` | `DONE` | `ROLLBACK_COMPLETE` | All actions reversed | Emit final state |

### Uninstall Transitions

| From | To | Trigger | Guard Condition | Action |
|------|----|---------|-----------------|---------|
| `INIT` | `PRE_UNFLIGHT` | `START` | Args parsed | Show confirmation |
| `PRE_UNFLIGHT` | `STORE_CLEANUP` | `USER_CONFIRMED` | User said yes | Begin cleanup |
| `PRE_UNFLIGHT` | `CANCELLED` | `USER_CANCELLED` | User said no | Show cancellation |
| `PRE_UNFLIGHT` | `STORE_CLEANUP` | `FORCE_YES` | --yes flag | Skip confirmation |
| `STORE_CLEANUP` | `HOOK_REMOVE` | `CLEANUP_OK` | Binding removed | Begin hook removal |
| `STORE_CLEANUP` | `HOOK_REMOVE` | `CLEANUP_DEGRADED` | Partial cleanup | Continue with warning |
| `STORE_CLEANUP` | `ERROR` | `CLEANUP_FAILED` | Cleanup error | Abort |
| `HOOK_REMOVE` | `MCP_DEREGISTER` | `HOOKS_REMOVED` | Hooks deleted | Begin MCP deregister |
| `HOOK_REMOVE` | `MCP_DEREGISTER` | `HOOKS_DEGRADED` | Some hooks remain | Continue with warning |
| `HOOK_REMOVE` | `ERROR` | `HOOKS_FAILED` | Removal error | Abort |
| `MCP_DEREGISTER` | `VALIDATION` | `MCP_DEREGISTERED` | MCP removed | Begin validation |
| `MCP_DEREGISTER` | `VALIDATION` | `MCP_DEGRADED` | Some MCP remain | Continue with warning |
| `MCP_DEREGISTER` | `ERROR` | `MCP_FAILED` | Deregistration error | Abort |
| `VALIDATION` | `COMPLETE` | `VALID_OK` | All checks passed | Show summary |
| `VALIDATION` | `ERROR` | `VALID_FAILED` | Critical check failed | Abort |

## State Events

### Event Schema

```typescript
interface StateEvent {
  type: string;
  timestamp: number;
  state: State;
  data?: Record<string, unknown>;
  error?: ErrorInfo;
}
```

### Install Events

| Event | Trigger | Data |
|-------|---------|------|
| `install:start` | INIT exit | `{ args, config }` |
| `preflight:check` | Each check | `{ check, result }` |
| `preflight:complete` | PREFLIGHT exit | `{ checks, warnings }` |
| `env:client:found` | Each client detected | `{ client, path, version }` |
| `env:complete` | ENV_DETECT exit | `{ clients, recommended }` |
| `store:selected` | User selection | `{ storeId }` |
| `store:created` | New store created | `{ storeId, path }` |
| `hook:installing` | Hook install start | `{ hook, client }` |
| `hook:installed` | Hook install success | `{ hook, client, path }` |
| `mcp:registering` | MCP registration start | `{ client }` |
| `mcp:registered` | MCP registration success | `{ client, configPath }` |
| `validation:check` | Each validation | `{ check, result }` |
| `validation:complete` | VALIDATION exit | `{ results }` |
| `install:complete` | GUIDANCE exit | `{ summary, metrics }` |
| `install:error` | ERROR state | `{ error, stage }` |
| `install:abort` | ABORT exit | `{ reason }` |
| `rollback:action` | Each rollback step | `{ action, result }` |

### Uninstall Events

| Event | Trigger | Data |
|-------|---------|------|
| `uninstall:start` | INIT exit | `{ args }` |
| `uninstall:confirmed` | User confirms | `{ }` |
| `uninstall:cancelled` | User cancels | `{ }` |
| `cleanup:binding` | Binding removed | `{ storeId, keptDir }` |
| `hook:removing` | Hook removal start | `{ hook, client }` |
| `hook:removed` | Hook removal success | `{ hook, client }` |
| `mcp:deregistering` | MCP deregister start | `{ client }` |
| `mcp:deregistered` | MCP deregister success | `{ client }` |
| `validation:check` | Each validation | `{ check, result }` |
| `uninstall:complete` | COMPLETE state | `{ summary }` |
| `uninstall:error` | ERROR state | `{ error, stage }` |

## State Persistence

### Persistence Schema

```typescript
interface PersistedState {
  sessionId: string;
  operation: 'install' | 'uninstall';
  currentState: State;
  stageHistory: StageResult[];
  config: InstallConfig | UninstallConfig;
  rollbackStack: RollbackAction[];
  createdAt: number;
  updatedAt: number;
}
```

### Persistence Location

- **Install**: `.fabric/.install-state.json` (temporary, deleted on complete)
- **Uninstall**: `.fabric/.uninstall-state.json` (temporary)
- **Session Log**: `~/.fabric/logs/install-{sessionId}.jsonl`

### Resume Feature (Future)

```typescript
// Future feature: resume interrupted install
async function resumeInstall(sessionId: string): Promise<void> {
  const persistedState = await loadPersistedState(sessionId);
  const stateMachine = createStateMachine(persistedState.currentState);
  
  // Reconstruct state from persisted data
  stateMachine.restore(persistedState);
  
  // Continue from last successful stage
  await stateMachine.continue();
}
```

## xstate Implementation

```typescript
import { createMachine, interpret } from 'xstate';

const installMachine = createMachine({
  id: 'install',
  initial: 'init',
  states: {
    init: {
      on: { START: 'preflight' },
    },
    preflight: {
      entry: ['runPreflightChecks'],
      on: {
        CHECKS_PASSED: 'env_detect',
        CHECKS_FAILED: 'error',
      },
    },
    env_detect: {
      entry: ['detectClients'],
      on: {
        CLIENTS_FOUND: 'store_config',
        NO_CLIENTS: 'store_config',
      },
    },
    store_config: {
      entry: ['startWizard'],
      on: {
        STORE_READY: 'hook_install',
        STORE_FAILED: 'error',
      },
    },
    hook_install: {
      entry: ['installHooks'],
      on: {
        HOOKS_OK: 'mcp_register',
        HOOKS_DEGRADED: 'mcp_register',
        HOOKS_FAILED: 'error',
      },
    },
    mcp_register: {
      entry: ['registerMCP'],
      on: {
        MCP_OK: 'validation',
        MCP_DEGRADED: 'validation',
        MCP_FAILED: 'error',
      },
    },
    validation: {
      entry: ['runValidation'],
      on: {
        VALID_OK: 'guidance',
        VALID_WARNINGS: 'guidance',
        VALID_FAILED: 'error',
      },
    },
    guidance: {
      entry: ['showGuidance'],
      on: { GUIDANCE_DONE: 'complete' },
    },
    complete: {
      type: 'final',
      entry: ['emitMetrics'],
    },
    error: {
      on: { ABORT_REQUESTED: 'abort' },
    },
    abort: {
      entry: ['executeRollback'],
      on: { ROLLBACK_START: 'rollback' },
    },
    rollback: {
      entry: ['runRollback'],
      type: 'final',
    },
  },
});
```

## Testing Strategy

### State Transition Tests

```typescript
describe('InstallStateMachine', () => {
  it('should transition from init to preflight on START', () => {
    const machine = interpret(installMachine).start();
    machine.send('START');
    expect(machine.state.value).toBe('preflight');
  });
  
  it('should transition to error on CHECKS_FAILED', () => {
    const machine = interpret(installMachine).start();
    machine.send('START');
    machine.send('CHECKS_FAILED', { error: new Error('Permission denied') });
    expect(machine.state.value).toBe('error');
  });
  
  it('should complete full install flow', async () => {
    const machine = interpret(installMachine).start();
    await machine.complete();
    expect(machine.state.value).toBe('complete');
  });
});
```

## References

- **ADR-001**: Pipeline stages definition
- **ADR-002**: ink TUI state integration
- **ADR-005**: Uninstall symmetry
- **xstate Documentation**: https://xstate.js.org/docs