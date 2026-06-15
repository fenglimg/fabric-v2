# Contributing to Fabric

Thanks for considering a contribution to Fabric. This guide covers what you need to know to get a clean PR through.

## TL;DR

```bash
git clone https://github.com/fenglimg/fabric-v2.git
cd fabric-v2
pnpm install
pnpm -r exec tsc --noEmit          # typecheck
pnpm -r test                       # tests (~1700 + property-based)
pnpm exec knip                     # dead-code lint
```

Then edit, commit (Chinese conventional-commit style — see below), open a PR against `main`.

## Project layout

```
packages/
├── shared/                          # @fenglimg/fabric-shared (Zod schemas, i18n, atomic-write helpers)
├── server/                          # @fenglimg/fabric-server (MCP knowledge server, stdio transport)
├── cli/                             # @fenglimg/fabric-cli (install / doctor / metrics / onboard-coverage)
└── server-http-experimental/        # Quarantined v1.8 HTTP/REST/SSE/Dashboard server (NOT built or tested)

docs/                                # Architecture decisions, getting-started, migration guides
.fabric/                             # In-repo dogfood (this repo uses its own KB)
.github/                             # ISSUE_TEMPLATE, workflows (CI + release)
```

## Development workflow

### Required gates (every commit must pass)

1. **Typecheck**: `pnpm -r exec tsc --noEmit` — zero errors across all packages.
2. **Tests**: `pnpm -r test` — ~1700 + property-based tests. Add tests for any new behavior.
3. **Knip**: `pnpm exec knip` — no NEW dead exports / dead devDependencies. Existing baseline is allowed.

### Recommended (catches CI failures locally)

- **Werewolf dogfood**: `node packages/cli/dist/index.js doctor --target ~/Desktop/projects/werewolf-minigame` — runs the full doctor suite against a real-world fixture. (Optional unless you changed doctor checks.)
- **Cross-package build**: when you change `packages/shared/`, run `pnpm --filter @fenglimg/fabric-shared build` so its DTS is rebuilt for downstream packages.

### Conventional-commit style (Chinese)

Format: `<type>(<scope>): <subject in Chinese>`

```
feat(rc37 NEW-3): 加 fab_recall 合并 API + selection_token TTL 5→30min
fix(server): correct partial-write tail handling in event-ledger
docs(README): clarify stdio-only transport
chore(deps): bump knip to 6.12.1
refactor(rc37 D2): 删 server 包 chokidar/express/supertest dev deps
```

Types: `feat` / `fix` / `refactor` / `docs` / `chore` / `test` / `perf`.

Body in Chinese (matches the project style); English summary OK if the change is purely mechanical (deps, formatting).

### Per-task per-commit discipline

For multi-task plans (e.g. closing an audit batch), prefer one commit per task instead of one giant commit. Makes review tractable and reverts surgical.

## Architectural decisions are KB-locked

Fabric uses its own knowledge base to record architecture decisions. Before proposing a significant change, check:

```bash
grep -rn "no-server-side-kb-filter\|fabric-serve-quarantine\|events-jsonl-plan-b" .fabric/knowledge/
```

If your change contradicts a locked decision, explain why in the PR description. Locked decisions can be revisited, but the bar is high.

## Adding a new MCP tool / Skill / doctor check

- **MCP tool**: schema goes in `packages/shared/src/schemas/api-contracts.ts`; service in `packages/server/src/services/`; tool wrapper in `packages/server/src/tools/`; registered in `packages/server/src/index.ts:createFabricServer`.
- **Skill**: canonical template in `packages/cli/templates/skills/<slug>/SKILL.md`; mirror to `.claude/skills/` + `.codex/skills/` for in-repo dogfood. `fabric install` copies templates to client targets.
- **Doctor check**: inspection function in `packages/server/src/services/doctor.ts`; i18n keys in `packages/shared/src/i18n/locales/{zh-CN,en}.ts`; registered in `runDoctorReport` checks list; snapshot tests in `packages/server/src/services/doctor.test.ts` need the count updated.

See existing examples in each path for the exact pattern.

## Release process

User-triggered only. Maintainers run:

```bash
fabric --version                                          # confirm current rc
pnpm release-rc                                           # or manual bump + tag + push
```

The `Release` GitHub Actions workflow handles publish. Contributors don't touch versions or tags.

## Code of conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Security

Reporting a security issue? See [SECURITY.md](./SECURITY.md) — please don't open a public issue for vulnerabilities.

## License

Contributions are licensed under [MIT](./LICENSE).
