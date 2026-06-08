# F-008 — Progress Feedback

> Role: system-architect | Related decisions: SA-04

## Architecture

Long-running operations MUST surface progress indicators to prevent the perception of stalling. The current install has three blocking operations without feedback:

1. **Forensic scan** — Recursively walks repository tree, loads tree-sitter parsers (lines 956-962 in install.ts)
2. **Bootstrap hook installation** — Copies multiple skill/hook templates (lines 1231-1296)
3. **File copy operations** — Scaffold writes events.jsonl, forensic.json, fabric-config.json

The OutputRenderer MUST provide spinner and progress bar primitives that integrate with ink components.

### Spinner Integration

The spinner MUST use ink-spinner under the hood, providing an ora-compatible handle:

```typescript
export interface SpinnerHandle {
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
}
```

Usage in forensic scan:

```typescript
const spinner = renderer.spinner('Scanning repository for forensic report...');
const report = await buildForensicReport(target);
spinner.succeed(`Scanned ${report.fileCount} files in ${report.duration}ms`);
```

### Progress Bar Integration

For file copy operations with known counts, the renderer MUST provide a progress bar:

```typescript
export interface ProgressHandle {
  tick(): void;
  complete(): void;
  fail(error: Error): void;
}
```

Usage in scaffold stage:

```typescript
const progress = renderer.progressBar('Writing scaffold files', 4);
await writeEventsJsonl();
progress.tick();
await writeForensicJson();
progress.tick();
await writeFabricConfig();
progress.tick();
await writeGitignore();
progress.tick();
progress.complete();
```

### Multi-Task Progress

For concurrent operations (e.g., installing to multiple clients), the renderer SHOULD support listr2-style multi-task visualization:

```typescript
export interface MultiProgressHandle {
  task(name: string): TaskHandle;
  complete(): void;
}

export interface TaskHandle {
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
}
```

Usage in bootstrap stage:

```typescript
const multi = renderer.multiProgress([
  { name: 'Claude Code', text: 'Installing skills...' },
  { name: 'Codex CLI', text: 'Installing skills...' },
  { name: 'Cursor', text: 'Installing hooks...' },
]);

await Promise.all([
  installClaudeSkills(target).then(() => multi.task('Claude Code').succeed('Installed 3 skills')),
  installCodexSkills(target).then(() => multi.task('Codex CLI').succeed('Installed 3 skills')),
  installCursorHooks(target).then(() => multi.task('Cursor').succeed('Installed 3 hooks')),
]);

multi.complete();
```

## Interface Contract

### SpinnerHandle

```typescript
export interface SpinnerHandle {
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
}
```

| Method | Behavior |
|--------|----------|
| `update(message)` | Update spinner text without stopping animation |
| `succeed(message)` | Stop spinner, replace with success symbol, wait 500ms before clearing |
| `fail(message)` | Stop spinner, replace with error symbol, wait 1000ms before clearing |

### ProgressHandle

```typescript
export interface ProgressHandle {
  tick(): void;
  complete(): void;
  fail(error: Error): void;
}
```

| Method | Behavior |
|--------|----------|
| `tick()` | Advance progress bar by 1 unit |
| `complete()` | Fill to 100%, display success, clear |
| `fail(error)` | Display error message, clear |

### MultiProgressHandle

```typescript
export interface MultiProgressHandle {
  task(name: string): TaskHandle;
  complete(): void;
}
```

### Consumers

- **forensic scan** — Use spinner for buildForensicReport call
- **scaffold stage** — Use progress bar for 4 file writes
- **bootstrap stage** — Use multi-progress for concurrent client installations
- **mcp stage** — Use spinner for package manager install (local mode)
- **hooks stage** — Use spinner for hook config merge

## Constraints (RFC 2119)

1. **Spinner for operations >100ms** — Any operation expected to take more than 100ms MUST use renderer.spinner. The forensic scan and bootstrap installation MUST always show progress.

2. **Timing feedback** — Completed operations MUST display "done in Xms" or "Xms" suffix. The succeed() method MUST include timing when available.

3. **Multi-task support** — Concurrent operations SHOULD use multi-progress visualization. The bootstrap stage installing to 3 clients SHOULD show parallel progress.

4. **Percentage for file copies** — File copy operations with known counts MAY show percentage. The progress bar MUST calculate percent as (current / total) * 100.

5. **Spinner update frequency** — Progress indicators MUST update at most every 50ms to avoid terminal flicker. Forensic scan file counting MUST batch updates.

6. **Non-TTY fallback** — When stderr is not a TTY (piped, CI, test), progress indicators MUST be suppressed. The renderer MUST check `process.stderr.isTTY` before rendering.

7. **ink-spinner integration** — The Spinner component MUST use ink-spinner with `type="dots"` animation. Alternative animations (line, bounce) MAY be configurable via theme.

## Test Approach

### Component Tests

```
tests/output/components/
├── Spinner.test.tsx
└── ProgressBar.test.tsx
```

Tests MUST verify:

1. **Spinner lifecycle** — Render spinner, call update, succeed; assert output frames
2. **Progress bar percent** — Render with total=10, call tick 5 times; assert 50% display
3. **Multi-task rendering** — Render with 3 tasks, complete in different order; assert output

### Integration Tests

`tests/install/progress-feedback.test.ts` MUST verify:

1. **Forensic scan spinner** — Mock buildForensicReport with 500ms delay; assert spinner appears
2. **Scaffold progress** — Run scaffold stage; assert progress bar with 4 ticks
3. **Bootstrap multi-progress** — Run bootstrap; assert parallel task visualization

### Performance Tests

```typescript
test('spinner does not flicker on fast updates', () => {
  const spinner = renderer.spinner('Test');
  for (let i = 0; i < 100; i++) {
    spinner.update(`Step ${i}`);
  }
  spinner.succeed('Done');
  // Assert no duplicate frames in output
});
```

## TODOs

1. **Install ink-spinner** — Add ink-spinner dependency to package.json.

2. **Create Spinner component** — Implement `output/components/Spinner.tsx` with ink-spinner integration.

3. **Create ProgressBar component** — Implement `output/components/ProgressBar.tsx` with percentage calculation.

4. **Add spinner() to OutputRenderer** — Implement method in InkOutputRenderer returning SpinnerHandle.

5. **Add progressBar() to OutputRenderer** — Implement method returning ProgressHandle.

6. **Add multiProgress() to OutputRenderer** — Implement method for concurrent tasks.

7. **Update forensic scan** — Wrap buildForensicReport call with spinner in scaffold stage.

8. **Update bootstrap stage** — Use multi-progress for concurrent client installations.

9. **Add non-TTY guard** — Check process.stderr.isTTY before rendering any progress indicator.

10. **Benchmark update frequency** — Test spinner with 100 updates in 100ms; assert no flicker.