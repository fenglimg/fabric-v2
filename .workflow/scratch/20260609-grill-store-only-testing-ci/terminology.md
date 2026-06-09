# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| store-only | Runtime knowledge source of truth is mounted stores under global Fabric home, not project-local `.fabric/knowledge`. | `.workflow/scratch/20260609-grill-store-only-architecture/grill-report.md` | locked |
| mounted-store workflow | End-to-end user path that creates/mounts/binds stores, writes pending knowledge, reviews/promotes it, and recalls canonical knowledge through the read-set. | `packages/shared/test/helpers/test-wall.ts` | locked |
| test wall | Real-fs isolated harness with fake home, store root, fake bare remote, and client config fixtures. | `packages/shared/test/helpers/test-wall.ts` | locked |
| red-suite | Failing-first contract suite or fixture ratchet used to prove a new behavior fails before implementation and stays green after promotion. | `packages/shared/test/resolver/golden-redsuite.test.ts` | open |
| invariant gate | CI check that asserts architecture rules directly, independent of generic line coverage. | `docs/TESTING.md` | locked |
| surface matrix | Release checklist/gate for CLI, server, MCP, hooks, skills, docs, tests, doctor, sync, and generated outputs. | prior store-only grill context | locked |
| packaged CLI gate | Test that invokes the packaged `fabric` bin or equivalent publish artifact entry, not just source imports or direct `node dist/index.js`. | `packages/cli/package.json` | locked |
| release parity | Requirement that release workflow runs all gates needed to protect the artifact, matching or reusing normal CI. | `.github/workflows/ci.yml`, `.github/workflows/release.yml` | locked |
| perf fixture | Benchmark input filesystem/config state used by cold-start gates. | `scripts/perf-benchmark.mjs` | open |
| dual-root fallback | Retired behavior that reads or writes project-local `.fabric/knowledge` / legacy home knowledge roots as runtime source. | `packages/server/src/services/cross-store-write.test.ts` | locked |
| write red | TDD practice of committing a failing test that captures the desired contract before making implementation pass. | user topic | open |

