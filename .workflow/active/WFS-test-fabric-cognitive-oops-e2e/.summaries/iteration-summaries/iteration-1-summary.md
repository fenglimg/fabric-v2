# Iteration 1 Summary

Status: passed
Date: 2026-04-25

## Commands Passed

- `pnpm -r build`
- `pnpm --filter @fenglimg/fabric-cli test`
- `pnpm --filter @fenglimg/fabric-server exec vitest run src/index.test.ts src/services/plan-context.test.ts src/services/rule-sections.test.ts src/services/audit-log.test.ts src/services/doctor.test.ts src/tools/rule-sections.test.ts`
- `pnpm --filter @fenglimg/fabric-shared exec vitest run test/agents-meta.test.ts`
- `node packages/cli/dist/index.js init --plan --target /mnt/c/Project/oops-framework`
- `node packages/cli/dist/index.js init --yes --target /tmp/fabric-oops-e2e/oops-framework`
- MCP stdio smoke using built server: `fab_plan_context` + `fab_get_rule_sections`
- `node packages/cli/dist/index.js doctor --audit --target /tmp/fabric-oops-e2e/oops-framework`

## Fixes Applied

- Made `buildInitialTaxonomyMarkdown` tolerate incomplete forensic-report mocks/fallbacks.
- Updated CLI i18n snapshots for `.fabric/INITIAL_TAXONOMY.md` creation output.
- Increased timeout for a known slow pre-commit test.

## E2E Result

The original `/mnt/c/Project/oops-framework` was used read-only. Full Fabric init and protocol validation ran in `/tmp/fabric-oops-e2e/oops-framework`.

Validated protocol points:

- `INITIAL_TAXONOMY.md` generated.
- `fab_plan_context` returned `selection_token`, neutral description index, L0/L2 required ids, and L1 selectable ids.
- `fab_get_rule_sections` merged required L0/L2 with AI-selected L1.
- Invalid token, invalid L1, required-id AI selection, and missing selection reason produced hard errors.
- Missing section returned warning diagnostic without full-content fallback.
- `rule_selection` audit was written.
- `doctor --audit` accepted the `rule_selection` event for an AI ledger entry.
