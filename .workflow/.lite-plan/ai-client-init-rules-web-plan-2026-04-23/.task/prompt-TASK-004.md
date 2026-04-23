## Goal
Add fab approve CLI command to compensate for Dashboard's zero-write positioning. CLI must provide batch approval capability.

## Task: CLI compensation — Add fab approve command with --all and --interactive modes

**Scope**: `packages/cli/src/commands/approve.ts + packages/cli/src/commands/index.ts` | **Action**: Implement

### Files
- **packages/cli/src/commands/approve.ts** → `new approve command module`: Define citty command with --all and --interactive flags. Load drift entries via readHumanLock(). In --all mode: loop all drift entries, call approveHumanLock() with new_hash=current_hash. In --interactive mode: display file:line, hash diff, prompt y/n per entry, approve on 'y'. Report summary count at end.
- **packages/cli/src/commands/index.ts** → `allCommands record`: Add approve command entry to allCommands

### Why this approach
Reuse existing approveHumanLock() server service directly — logic already correct and tested.
Key factors: human-lint.ts already imports from shared package — CLI→server imports are established pattern, Zero logic duplication.
Tradeoffs: CLI must import server package directly — acceptable since other CLI commands follow the same pattern.

### How to do it
Add fab approve CLI command to compensate for Dashboard's zero-write positioning. Implements two modes: --all (batch approve all drift entries) and --interactive (per-entry confirmation with diff display). Reuses approveHumanLock() from packages/server and readHumanLock() from packages/server.

1. Create packages/cli/src/commands/approve.ts using defineCommand from citty
2. Define args: --all (boolean flag), --interactive (boolean flag), --target (string, default cwd)
3. Import readHumanLock-related functions (check existing import path pattern in cli commands — look at human-lint.ts)
4. Import approveHumanLock from server package (check package.json dependencies)
5. Implement --all mode: filter drift entries (entry.drift === true), call approveHumanLock() for each with new_hash = entry.current_hash, print summary
6. Implement --interactive mode: for each drift entry, print file:line, expected vs actual hash, prompt y/n via stdin readline, approve on y/yes
7. Handle case: zero drift entries → print 'No drift entries found' and exit 0
8. Register in index.ts allCommands

### Code skeleton
**Function**: `runApproveAll(projectRoot: string): Promise<void>` — Batch approve all drift entries using approveHumanLock()
**Function**: `runApproveInteractive(projectRoot: string): Promise<void>` — Prompt per-entry approval with diff display

### Reference
- Pattern: citty defineCommand pattern with readline prompt
- Files: packages/cli/src/commands/human-lint.ts, packages/server/src/services/approve-human-lock.ts, packages/server/src/services/read-human-lock.ts
- Notes: Follow human-lint.ts command structure: defineCommand, args with target, async run. Use same normalizeTarget pattern.

### Risk mitigations
- CLI package may not have direct dependency on server package → **Check packages/cli/package.json for server dependency; add if missing or use @fenglimg/fabric-shared re-exports**

### Done when
- [ ] fab approve --all approves all drift entries (entries where drift=true) in a single invocation
- [ ] fab approve --interactive prompts for each drift entry and only approves confirmed entries
- [ ] fab approve with no flags prints usage help (citty built-in)
- [ ] Zero drift entries case exits cleanly with informational message
- [ ] Command registered in allCommands and accessible as fab approve
- [ ] Each approved entry produces a ledger event (via approveHumanLock internal behavior)

**Success metrics**: All drift entries approved in --all mode with correct ledger entries created, Interactive mode processes each entry individually without skipping

Complete each item in the "Done when" checklist.
