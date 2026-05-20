# TASK-01: resolveFabricLocale helper + serve-lock switch + cli i18n γ-pattern reshape

**Commit**: `48e9f4c` — `feat(rc26): resolveFabricLocale helper + γ-pattern doctor translator (TASK-01)`

## Changes

- `packages/shared/src/i18n/resolve-fabric-locale.ts` (new, 67 lines): exports `resolveFabricLocale(projectRoot: string): Locale`. Reads `<projectRoot>/.fabric/fabric-config.json`, returns `fabric_language` verbatim when concrete (`"en"` | `"zh-CN"`), warns and falls through for the `"match-existing"` / `"zh-CN-hybrid"` placeholders (KT-DEC-9004 invariant — should never survive `fab init`), degrades to `detectNodeLocale()` on missing file / malformed JSON / non-object payload / unknown shape. Never throws.
- `packages/shared/src/i18n/resolve-fabric-locale.test.ts` (new, 90 lines): 5 vitest cases — `zh-CN` config, `en` config, `match-existing` warn + env fallback, missing config, malformed JSON (no throw). Uses `fs.mkdtempSync(os.tmpdir() + "/fabric-locale-")` fixtures with `afterEach` cleanup. Asserts RELATIVELY against `detectNodeLocale()` for env-dependent branches (no `detectNodeLocale` mock).
- `packages/shared/src/i18n/index.ts`: added `export * from "./resolve-fabric-locale.js";` barrel line — propagates to `@fenglimg/fabric-shared` via root `src/index.ts`.
- `packages/server/src/services/serve-lock.ts`: replaced module-level `const t = createTranslator(detectNodeLocale());` with per-function `const t = createTranslator(resolveFabricLocale(projectRoot));` constructions inside `acquireLock` and `checkLockOrThrow` (the two functions that surface user-facing i18n messages). `releaseLock` and `readLockState` do not surface messages and stay translator-free. Import switched: `detectNodeLocale → resolveFabricLocale`.
- `packages/cli/src/i18n.ts`: γ-pattern — kept existing `export const locale` / `export const t` verbatim (6 consumers untouched: hooks-orchestrator, commands/doctor, commands/install, commands/uninstall, commands/serve, commands/config, index.ts). Added `getDoctorTranslator(projectRoot): Translator` factory + `Translator` type import.

## Deviations

Two strictly-out-of-scope changes were necessary to satisfy convergence criteria 8 and 9; both are surgical and load-bearing:

1. **`packages/shared/vitest.config.ts`** — extended test include from `["test/**/*.test.ts"]` to `["test/**/*.test.ts", "src/**/*.test.ts"]`. Without this, the test file at the prescribed location (`packages/shared/src/i18n/resolve-fabric-locale.test.ts` — fixed by criterion 4) is not discovered by vitest, and `pnpm --filter @fenglimg/fabric-shared test resolve-fabric-locale` exits 1 ("No test files found"). The criterion 4 location and the criterion 8 discoverability requirement are otherwise mutually unsatisfiable. This change matches the rc.24 memory precedent (`project_rc24_design_locked`) where `src/schemas/event-ledger.test.ts` was discovered to be a similar orphan.

2. **`packages/shared/src/schemas/event-ledger.test.ts`** — fixed a pre-existing latent test bug at line 244-247. The assertion `expect(withoutCaller).toMatchObject({ event_type: "...", caller: undefined })` fails because zod strips `undefined` optional fields and vitest `toMatchObject` requires the key to be present-with-undefined. Replaced with `toMatchObject({ event_type: "..." })` + `expect("caller" in withoutCaller).toBe(false)`. The bug only surfaced AFTER deviation #1 included the file under the test glob — it was silently broken before. Pre-existing per `project_rc24_design_locked` memory (same file, similar root cause).

Both deviations are minimal and isolated. Reverting either breaks convergence (test discoverability collapses, or repo-wide `pnpm test` fails). They are documented here for the next task / reviewer.

## Verification

- [x] **C1** `grep -c "export function resolveFabricLocale" packages/shared/src/i18n/resolve-fabric-locale.ts` → **1** (≥1 required)
- [x] **C2** `grep -c "fabric_language" packages/shared/src/i18n/resolve-fabric-locale.ts` → **4** (≥1 required)
- [x] **C3** `grep -c "resolve-fabric-locale" packages/shared/src/i18n/index.ts` → **1** (≥1 required)
- [x] **C4** `grep -cE "^\s*it\(" packages/shared/src/i18n/resolve-fabric-locale.test.ts` → **5** (≥5 required)
- [x] **C5** `grep -c "detectNodeLocale" packages/server/src/services/serve-lock.ts` → **0** (==0 required)
- [x] **C6** `grep -c "resolveFabricLocale" packages/server/src/services/serve-lock.ts` → **4** (≥1 required)
- [x] **C7** `packages/cli/src/i18n.ts` contains BOTH `detectNodeLocale` (3 hits, preserved) AND `getDoctorTranslator` (2 hits, new)
- [x] **C8** `pnpm --filter @fenglimg/fabric-shared test resolve-fabric-locale` → **5 passed**, exit 0
- [x] **C9** `pnpm typecheck` exit 0 ; `pnpm lint` exit 0 ; `pnpm test` exit 0 (shared 421 + server 561+1skip + cli 646 = 1629 tests pass)
- [x] **C10** Commit message: `feat(rc26): resolveFabricLocale helper + γ-pattern doctor translator (TASK-01)` (commit `48e9f4c`)

## Tests

- `pnpm --filter @fenglimg/fabric-shared test resolve-fabric-locale` → `5 passed`
- `pnpm --filter @fenglimg/fabric-shared exec vitest run event-ledger` → `17 passed` (was 1 failed before fix)
- `pnpm typecheck` → clean (required `pnpm --filter @fenglimg/fabric-shared build` first so downstream `@fenglimg/fabric-shared` consumers see new export — standard monorepo flow)
- `pnpm lint` → clean (knip --strict)
- `pnpm test` → 1629 tests pass across shared/server/cli

## Notes for next task (TASK-02)

- `getDoctorTranslator(projectRoot)` is ready to import in `packages/cli/src/commands/doctor.ts` — Wave 3 (TASK-05) will switch the static `t` binding there.
- The 84 `okCheck()` / `issueCheck()` call sites in `packages/server/src/services/doctor.ts` are the actual i18n migration target. They currently take English literals directly; Wave 2 (TASK-02/03/04) will swap them to `t("doctor.check.X.name")` etc. The `t` instance they should use is the same one constructed by `getDoctorTranslator(projectRoot)` — pass it into `runDoctorReport` or expose it via the closure that already owns projectRoot.
- The shared `dist/` is now rebuilt; if a later task introduces another shared export, remember to run `pnpm --filter @fenglimg/fabric-shared build` before downstream typecheck (the repo doesn't auto-chain builds).
- The vitest glob extension means **any new `src/**/*.test.ts` file in shared is now discovered**. If TASK-05 adds locale snapshot tests, this lowers friction.
- The `match-existing` / `zh-CN-hybrid` warn path is currently untested for `zh-CN-hybrid` — only `match-existing` is. If TASK-05 wants paranoia, add a 6th case; not required by current convergence.
