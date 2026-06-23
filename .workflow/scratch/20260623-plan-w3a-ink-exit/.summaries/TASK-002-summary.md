# TASK-002 Summary — Delete Ink surface + remove ink/react deps

## Files deleted (12)
- 10 `tui/*.tsx`: SectionHeader, StepCounter, Spinner, StatusMessage, ErrorBox, SummaryCard, ProgressBar, InputField, StoreWizard, StoreWizardFlow.
- `tui/InkOutputRenderer.ts` (superseded by ConsoleOutputRenderer in TASK-001).
- `__tests__/ink-react-compat.test.ts` (asserted ink===^4.4.1 && react===^18.3.1 — enforced the deps under removal).

## Files modified
- `tui/types.ts` — deleted `import type { ReactNode } from "react";` + the dead `InkOutputRenderer extends OutputRenderer` interface (`renderCustom`/`getInkInstance`). OutputRenderer interface body + all other types byte-identical.
- `tui/index.ts` — rewrote barrel: kept type re-exports (StepInfo/SummaryInfo/SummaryDetailRow/ErrorInfo/OutputRenderer/OutputRendererConfig) + `ConsoleOutputRenderer`/`createInstallRenderer`/`toErrorInfo`; removed all Ink component exports + `InkOutputRenderer`/`createInkRenderer` + the line-8 `InkOutputRenderer as InkOutputRendererType` re-export.
- `package.json` — removed `"ink": "^4.4.1"` + `"react": "^18.3.1"` (dependencies) + `"@types/react": "^18.3.12"` (devDependencies). Kept `@clack/prompts` + `picocolors`.
- Reworded 2 docstring comments in ConsoleOutputRenderer.ts to drop literal `InkOutputRenderer`/`createInkRenderer` tokens (satisfies the no-Ink-symbol grep gate).
- Lockfile refreshed via `pnpm install`.

## Convergence verification
- ✅ No `.tsx` under `tui/`; `InkOutputRenderer.ts` absent; `ink-react-compat.test.ts` absent.
- ✅ `grep ink/react imports` in `packages/cli/src` → none.
- ✅ `grep createInkRenderer|InkOutputRenderer` in `packages/cli/src` → none (comments reworded).
- ✅ package.json has no ink/react/@types/react; @clack/prompts + picocolors retained.
- ✅ `tui/index.ts` exports createInstallRenderer, no Ink/InkOutputRendererType re-export.
- ✅ `pipeline.ts` byte-unchanged; `types.ts` diff limited to react-import + dead InkOutputRenderer interface, OutputRenderer body byte-identical; `types.ts` has no react import / no InkOutputRenderer.
- ✅ `pnpm install` exit 0; `pnpm -r exec tsc --noEmit` exit 0 (**react fully removed and tree still type-checks — the plan-checker's contradiction resolved**).

## Notes
- Dangling-ref sweep across `packages/cli/src` + `__tests__` confirmed zero external consumers of any deleted component/symbol (only the `renderSummaryCard` interface method + pipeline call, which are legit). Confirms the verified-map "Ink confined to tui/" claim.
