# ADR-001: Install Pipeline Refactoring

## Status

**ACCEPTED** (SA-01 Locked)

## Context

The current Fabric CLI install flow has evolved organically, resulting in:
- Monolithic command handler with mixed concerns
- Scattered error handling without clear recovery paths
- Inconsistent output formatting across code paths
- Difficult to test individual stages in isolation
- No clear state machine, making resumption impossible

The install experience MUST support:
1. **First-time users**: Guided onboarding with sensible defaults
2. **Power users**: Minimal friction with `--yes` flag
3. **Multi-store scenarios**: Explicit store selection/creation
4. **Graceful degradation**: Non-fatal errors should not block progress
5. **Observability**: Each stage emits structured events for telemetry

## Decision

We SHALL refactor the install flow into a **7-stage pipeline** with explicit state transitions:

```
┌─────────────┐   ┌──────────────────┐   ┌────────────────────┐
│  Stage 1    │──▶│  Stage 2         │──▶│  Stage 3           │
│  Preflight  │   │  Environment     │   │  Store Config      │
│  Check      │   │  Detection       │   │  (Wizard)          │
└─────────────┘   └──────────────────┘   └────────────────────┘
                                                  │
                                                  ▼
┌─────────────┐   ┌──────────────────┐   ┌────────────────────┐
│  Stage 7    │◀──│  Stage 6         │◀──│  Stage 4           │
│  Post-Setup │   │  Validation      │   │  Hook Install      │
│  Guidance   │   │                  │   │                    │
└─────────────┘   └──────────────────┘   └────────────────────┘
                         ▲
                         │
                  ┌──────────────────┐
                  │  Stage 5         │
                  │  MCP Register    │
                  └──────────────────┘
```

### Stage Definitions

#### Stage 1: Preflight Check
**Purpose**: Validate prerequisites before any side effects.

**Checks**:
- Node.js version >= 18.0.0
- Write permissions to project directory
- Fabric CLI version compatibility
- No conflicting installations (`.fabric` already exists)
- Git repository detection (warning only)

**Outputs**:
- `PreflightResult`: `{ checks: CheckResult[], warnings: Warning[], canProceed: boolean }`

**Error Handling**:
- **Permanent**: Node.js version mismatch, no write permissions
- **Warning**: Non-git directory, existing `.fabric` (prompt to overwrite)

#### Stage 2: Environment Detection
**Purpose**: Auto-detect client configurations.

**Detection Logic**:
```typescript
interface EnvironmentResult {
  clients: {
    type: ClientType;
    configPath: string;
    exists: boolean;
    version?: string;
  }[];
  recommended: ClientType[];
}
```

**Detection Priority**:
1. Claude Code: `.claude/` directory, `claude` binary
2. Cursor: `.cursor/` directory, Cursor IDE detection
3. Codex CLI: `.codex/` directory, `codex` binary

**Error Handling**:
- **Degraded**: No clients detected → prompt for manual selection
- **Warning**: Client config exists but malformed → offer repair

#### Stage 3: Store Configuration (Wizard)
**Purpose**: Interactive store onboarding with guided choices.

**Wizard Flow**:
```
                    ┌─────────────────────┐
                    │  Store exists?      │
                    └──────────┬──────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
          [Yes, use]      [Create new]     [Connect remote]
               │               │               │
               ▼               ▼               ▼
          Select from      Store path      Remote URL
          existing list    input           input
               │               │               │
               └───────────────┴───────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Set as default?    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Confirm summary   │
                    └─────────────────────┘
```

**Non-Interactive Mode**:
- `--store <id>`: Use existing store
- `--create-store <path>`: Create new store
- `--connect-store <url>`: Connect remote store
- `--yes`: Accept all defaults

**Outputs**:
- `StoreConfig`: Complete store configuration ready for persistence

#### Stage 4: Hook Installation
**Purpose**: Deploy hook templates to client directories.

**Hook Types**:
| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start` | AI session begins | Load KB, surface hints |
| `pre-tool-use` | Before file edit | Narrow hint injection |
| `post-tool-use` | After file edit | Counter increment, archive nudge |

**Installation Steps**:
1. Resolve template source (bundled or custom)
2. Render template with store config
3. Write to client hook directory (`.claude/hooks/`, `.cursor/hooks/`, etc.)
4. Set executable permissions (Unix: `chmod +x`)

**Error Handling**:
- **Transient**: File lock → retry with backoff
- **Permanent**: Permission denied → abort with fix instructions
- **Degraded**: One client fails → continue with others, log warning

#### Stage 5: MCP Registration
**Purpose**: Register Fabric MCP server in client configs.

**Registration Logic**:
```typescript
interface MCPRegistration {
  client: ClientType;
  configPath: string;
  serverDefinition: {
    command: string;  // node /path/to/fabric-mcp-server
    args: string[];
    env?: Record<string, string>;
  };
}
```

**Client-Specific Config Formats**:
- **Claude Code**: `.claude/settings.json` → `mcpServers.fabric`
- **Cursor**: `.cursor/mcp.json` → `servers.fabric`
- **Codex CLI**: `.codex/config.json` → `mcp.servers.fabric`

**Error Handling**:
- **Degraded**: Client config malformed → backup + recreate
- **Permanent**: Cannot write config → abort with path diagnostic

#### Stage 6: Validation
**Purpose**: Verify installation integrity.

**Validation Checks**:
1. Hook files exist and are executable (Unix)
2. MCP server registered in all selected clients
3. Store config readable
4. Test MCP server startup (optional, `--validate` flag)

**Outputs**:
- `ValidationResult`: `{ checks: CheckResult[], errors: Error[], warnings: Warning[] }`

**Error Handling**:
- **Permanent**: Critical validation failure → abort with rollback
- **Warning**: Non-critical check failed → log, continue

#### Stage 7: Post-Setup Guidance
**Purpose**: Provide user with next steps.

**Guidance Components**:
1. **Summary Card**: Visual summary of installed components
2. **Next Steps**: Recommended actions (verify, test, explore)
3. **Documentation Links**: Relevant docs based on configuration
4. **Quick Start Command**: Example usage to get started

**Output Format**:
```
╔═══════════════════════════════════════════════════════════════╗
║                    Fabric Installation Complete                ║
╠═══════════════════════════════════════════════════════════════╣
║  Store:      ~/.fabric/stores/default (created)               ║
║  Clients:    Claude Code, Cursor                               ║
║  Hooks:      session-start, pre-tool-use, post-tool-use       ║
║  MCP:        Registered in 2 clients                          ║
╠═══════════════════════════════════════════════════════════════╣
║  Next Steps:                                                   ║
║  1. Verify:     fabric doctor                                 ║
║  2. Add knowledge: fabric import <file>                       ║
║  3. View docs:   fabric docs --web                            ║
╚═══════════════════════════════════════════════════════════════╝
```

## Alternatives Considered

### Alternative 1: Keep Monolithic Handler
**Pros**: No refactoring effort, stable codebase
**Cons**: Does not address maintainability, testability, or observability concerns
**Decision**: Rejected — does not meet requirements

### Alternative 2: Pipeline with Configurable Stages
**Pros**: Extensible, plugin architecture
**Cons**: Over-engineering for current needs, increased complexity
**Decision**: Rejected — YAGNI, can add later if needed

### Alternative 3: Pipeline with Middleware Pattern
**Pros**: Express.js-style chaining, familiar to Node.js developers
**Cons**: Less explicit state management, harder to visualize
**Decision**: Rejected — state machine approach provides clearer visibility

## Consequences

### Positive
- **Testability**: Each stage unit-testable in isolation
- **Observability**: Clear stage boundaries enable precise telemetry
- **Resumability**: State persistence enables future resume feature
- **Maintainability**: Single responsibility per stage
- **Extensibility**: New stages can be inserted without refactoring

### Negative
- **Initial Effort**: Full rewrite of install flow
- **Complexity**: More files, more abstraction
- **Migration**: Existing users need to re-run install

### Neutral
- **Bundle Size**: Slightly larger due to state machine library
- **Runtime Overhead**: Minimal (< 10ms stage transition)

## Implementation Notes

1. **State Persistence**: Store state in `.fabric/.install-state.json` during install
2. **Atomic Operations**: Use temp directories + rename for file writes
3. **Rollback Strategy**: Track all mutations, reverse on permanent failure
4. **Progress Reporting**: Emit events on stage transitions for ink TUI

## References

- **SA-01**: Original brainstorm decision
- **ADR-002**: ink TUI architecture for stage rendering
- **ADR-003**: OutputRenderer for consistent formatting
- **state-machine.md**: Detailed state transition specification