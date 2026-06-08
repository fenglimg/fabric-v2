# System Architect Analysis — Fabric CLI Install/Uninstall UX Refactoring

> Contract: guidance-specification.md §4 (decisions SA-01 through SA-04)
> Owns: Pipeline stage decomposition, ink architecture design, uninstall symmetry, OutputRenderer abstraction
> Does not own: Wizard flow UX (UX-01), visual anchor styling (UI-01), summary card layout (UI-02), per-stage testing strategy (TS-01)

## 1. Role Mandate (167 words)

The System Architect role defines the structural decomposition of the install/uninstall pipeline into discrete, idempotent stages with explicit scope boundaries and failure modes. This role owns the introduction of ink as the primary TUI framework, establishing the OutputRenderer abstraction that replaces the current fragmented console.log/writeStderr/clack output system. The architect ensures uninstall mirrors install with symmetric stage ordering and resolves the orphan store-binding gap. Behavioral constraints use RFC 2119 keywords. The architect defers wizard prompt wording (UX Expert), visual styling (UI Designer), and test coverage (Test Strategist). The current install.ts monolith (~2025 lines) MUST refactor into 7 named stages with clear pre/post conditions, enabling per-stage unit testing and granular error recovery.

## 2. Decision Digest

### Decisions
| ID | Feature | Stance | Constraints (RFC 2119) |
|----|---------|--------|------------------------|
| SA-01 | F-001-install-stage-refactor | Decompose install.ts into 7 discrete stages | MUST separate global-layer (uid + personal store) from project-scaffold; MUST add store-onboarding stage with interactive wizard; MUST ensure each stage is idempotent; SHOULD detect context automatically |
| SA-02 | F-002-ink-output-layer | Introduce ink as primary UI framework | MUST use ink components for all user-facing output; MUST implement OutputRenderer abstraction layer; SHOULD use @inkjs/ui for standard components; MAY retain clack for simple prompts during migration |
| SA-03 | F-004-uninstall-symmetry | Add store-binding-cleanup stage to uninstall | MUST mirror install stages in reverse order; MUST preserve knowledge content (E4 protocol); MUST prompt user before unmount store; SHOULD provide rollback path via re-run `fabric install` |
| SA-04 | F-008-progress-feedback | Add spinner and progress indicators | MUST use ora-style spinner for forensic scan, bootstrap hooks; MUST show "done in Xms" timing feedback; SHOULD support multi-task progress for concurrent operations; MAY show percentage for file copy |

### Interfaces
| Name | Contract | Consumers |
|------|----------|-----------|
| `InstallStage` | `{ name: string; execute(): Promise<StageResult>; idempotent: boolean; failureMode: 'graceful' | 'hard-fail' }` | Wizard orchestrator, test harness, doctor integration |
| `OutputRenderer` | `{ stepHeader(stage: string, step: number, total: number): void; spinner(operation: string): SpinnerHandle; summaryCard(data: SummaryData): void; errorBox(error: Error): void }` | All install/uninstall stages, doctor, future config command |
| `UninstallStage` | Mirror of `InstallStage` with reverse ordering | Uninstall orchestrator |
| `ProgressHandle` | `{ update(percent: number): void; complete(): void; fail(error: Error): void }` | Forensic scan, file copy, concurrent operations |

### Cross-Cutting Positions
| Topic | Stance |
|-------|--------|
| **Data Model** | InstallStage MUST have explicit input/output contracts; stage execution MUST NOT mutate shared state outside its declared output schema |
| **State Machine** | Install MUST track per-stage completion in events.jsonl; re-run MUST skip completed stages unless forced |
| **Error Handling Strategy** | Graceful-failure stages MUST log and continue; hard-fail stages MUST abort pipeline and emit recovery suggestion |
| **Observability Requirements** | Each stage MUST emit `install_stage_completed` event with duration, files_written, errors; spinner MUST surface live progress for operations >100ms |
| **Configuration Model** | OutputRenderer MUST read color palette from fabric-config.json; NO_COLOR env MUST override all color output |
| **Boundary Scenarios** | Concurrent install in multiple terminals MUST be safe; interrupted install MUST leave recoverable partial state; rollback MUST be achievable via `fabric uninstall && fabric install` |

### Findings Summary
| Slug | Title | Impact |
|------|-------|--------|
| existing-stage-count | Current install has 6 stages, not 7 | MEDIUM — guidance assumes 7; must add store-onboarding |
| no-output-layer | No unified output abstraction exists | HIGH — three-system fragmentation (console.log/writeStderr/clack) |
| uninstall-missing-store-bind | uninstall.ts lacks store-binding cleanup | HIGH — leaves orphan entries in global registry |
| forensic-scan-blocking | Forensic scan runs synchronously without feedback | MEDIUM — users perceive stall on large repos |

## 3. Cross-Cutting Foundations

### Data Model

The **InstallStage** data model MUST capture the atomic unit of pipeline execution. Each stage MUST declare its scope boundary through explicit input/output contracts:

```typescript
type InstallStageInput = {
  target: string;
  options: InitOptions;
  globalRoot: string;
  previousResults: Map<StageName, StageResult>;
};

type InstallStageOutput = {
  disposition: 'ran' | 'skipped' | 'failed';
  filesWritten: string[];
  errors: StageError[];
  durationMs: number;
};

type InstallStageContract = {
  name: StageName;
  inputSchema: InstallStageInput;
  outputSchema: InstallStageOutput;
  idempotent: boolean;
  failureMode: 'graceful' | 'hard-fail';
  prerequisites: StageName[];
};
```

The **StageResult** MUST be persisted to events.jsonl after each stage completion. Re-running install MUST consult this ledger to determine which stages to skip. The input MUST NOT mutate shared state outside the declared output schema — this constraint ensures concurrent install sessions in multiple terminals do not race on shared artifacts.

### State Machine

The install MUST follow a linear progression through 7 named stages:

```
[preflight] -> [global-setup] -> [scaffold] -> [store-onboarding] -> [bootstrap] -> [mcp] -> [hooks]
```

Each transition MUST satisfy the prerequisite condition:

| From | To | Condition |
|------|-----|-----------|
| preflight | global-setup | target directory exists, write permissions confirmed |
| global-setup | scaffold | globalRoot has valid uid, personal store initialized |
| scaffold | store-onboarding | .fabric/fabric-config.json written, events.jsonl created |
| store-onboarding | bootstrap | either store bound OR user chose "skip" path |
| bootstrap | mcp | at least one client bootstrap written (or all failed gracefully) |
| mcp | hooks | MCP configs updated (or mcp stage skipped) |
| hooks | complete | all hook configs merged (or hooks stage skipped) |

The state MUST be recoverable from events.jsonl. An interrupted install MUST resume by replaying completed stages and re-entering at the first incomplete stage. The rollback path MUST be `fabric uninstall && fabric install` — this MUST produce a clean slate regardless of interruption point.

### Error Handling Strategy

Each stage MUST declare its failure mode:

| Stage | Failure Mode | Recovery |
|-------|--------------|----------|
| preflight | hard-fail | Fix target directory permissions, re-run |
| global-setup | hard-fail | Check ~/.fabric ownership, re-run |
| scaffold | graceful | Partial scaffold files preserved; doctor can repair |
| store-onboarding | graceful | Skip path always available; store bind later via `fabric store bind` |
| bootstrap | graceful | Failed clients skipped; successful clients proceed |
| mcp | graceful | Failed MCP configs skipped; manual install via client settings |
| hooks | graceful | Failed hook configs skipped; manual merge via doctor |

Graceful-failure stages MUST log the error to stderr via OutputRenderer.errorBox and MUST continue to subsequent stages. Hard-fail stages MUST abort the pipeline MUST emit a recovery suggestion card. The OutputRenderer MUST differentiate error visual weight per UX-03 constraints.

### Observability Requirements

Each stage MUST emit an `install_stage_completed` event to events.jsonl with the following schema:

```json
{
  "kind": "fabric-event",
  "event_type": "install_stage_completed",
  "stage": "bootstrap",
  "disposition": "ran",
  "files_written": [".claude/skills/fabric-archive/SKILL.md"],
  "errors": [],
  "duration_ms": 1250
}
```

The forensic scan MUST surface a spinner when operation duration exceeds 100ms threshold. The OutputRenderer MUST provide:

- `spinner(operation: string)` — returns a handle with `update(message)`, `succeed(message)`, `fail(message)`
- `progressBar(operation: string, total: number)` — returns a handle with `tick()`, `complete()`
- `multiProgress(tasks: Task[])` — listr2-style concurrent task visualization

The timing feedback MUST display "done in Xms" after each stage completion (per UX-04).

### Configuration Model

The OutputRenderer MUST read color palette from `.fabric/fabric-config.json` under a new `cli_theme` field:

```json
{
  "cli_theme": {
    "success": "green",
    "warning": "yellow",
    "error": "red",
    "info": "cyan",
    "muted": "gray"
  }
}
```

The NO_COLOR environment variable MUST override all color output, forcing monochrome rendering. The renderer MUST support a `compact` mode triggered by `--quiet` flag, reducing summary card height to ≤5 lines.

### Boundary Scenarios

**Concurrent install**: Two terminals running `fabric install` on the same target MUST be safe due to per-stage idempotency and atomic writes (atomicWriteJson, atomicWriteText). The events.jsonl append MUST use file locking to prevent ledger corruption.

**Interrupted install**: Ctrl+C during scaffold MUST leave partial state recoverable. The user MUST run `fabric doctor --fix` to detect missing pieces, or `fabric uninstall && fabric install` for full reset.

**Rollback path**: `fabric uninstall && fabric install` MUST produce identical state to a fresh install. The uninstall MUST clean all managed artifacts; the install MUST re-create canonical state.

**Large repo forensic scan**: Repositories with >10,000 files MUST show spinner with file count progress. The spinner MUST update every 100 files to avoid terminal flicker.

## 4. File Index

| File | Type | Feature | Headings |
|------|------|---------|----------|
| [analysis-F-001-install-stage-refactor.md](analysis-F-001-install-stage-refactor.md) | feature | F-001 | Architecture, Interface Contract, Constraints, Test Approach, TODOs |
| [analysis-F-002-ink-output-layer.md](analysis-F-002-ink-output-layer.md) | feature | F-002 | Architecture, Interface Contract, Constraints, Test Approach, TODOs |
| [analysis-F-004-uninstall-symmetry.md](analysis-F-004-uninstall-symmetry.md) | feature | F-004 | Architecture, Interface Contract, Constraints, Test Approach, TODOs |
| [analysis-F-008-progress-feedback.md](analysis-F-008-progress-feedback.md) | feature | F-008 | Architecture, Interface Contract, Constraints, Test Approach, TODOs |
| [findings-existing-stage-count.md](findings-existing-stage-count.md) | finding | — | Description, Affected Features, Recommendation |

## 5. Outstanding TODOs

1. **Study existing stage flow** — Audit install.ts to map current 6 stages to proposed 7-stage decomposition; identify where global-setup and store-onboarding split occurs.
2. **Determine ink version** — Evaluate ink vs inkjs npm packages; confirm React paradigm compatibility with existing TypeScript build.
3. **Design OutputRenderer migration path** — Plan phased rollout: (a) create OutputRenderer abstraction, (b) migrate console.log calls, (c) migrate clack prompts, (d) retire writeStderr.
4. **Define store-binding-cleanup contract** — Specify what uninstall MUST clean: project .fabric/fabric-config.json `active_write_store`, global ~/.fabric/stores/<uuid>/ registry, bindings snapshot.
5. **Benchmark spinner libraries** — Compare ora, listr2, and ink-spinner for performance, terminal compatibility, and React integration.
6. **External research** — Study ink-based CLI projects (e.g., create-next-app, npm init) for TUI patterns and error presentation best practices.