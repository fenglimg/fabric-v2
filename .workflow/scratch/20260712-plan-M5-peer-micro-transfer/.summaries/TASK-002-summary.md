# TASK-002 Summary — P0-2 altitude body quality lint

## Status
completed

## Files changed
- packages/server/src/services/extract-knowledge.ts — assessBodyAltitude + default warn / FABRIC_ALTITUDE_PROPOSE_GATE refuse
- packages/server/src/services/extract-knowledge.test.ts — dump + long guideline fixtures
- packages/server/src/services/doctor-body-altitude.ts — warn-only knowledge_body_altitude_dump
- packages/server/src/services/doctor-check-registry.ts + doctor.ts — register check
- packages/cli/templates/skills/fabric-archive/SKILL.md — body altitude guidance
- packages/shared/src/i18n/locales/en.ts + zh-CN.ts — doctor.check.knowledge_body_altitude_dump.*
- doctor.test.ts + doctor-i18n snapshots updated for +1 check

## Convergence
- [x] body_altitude_dump code present
- [x] dump fixture warns/refuses; long structured guideline accepted
- [x] doctor warn-only altitude lint
- [x] extract-knowledge tests pass (59)

## Tests
pnpm --filter @fenglimg/fabric-server exec vitest run src/services/extract-knowledge.test.ts
