# Fabric Roadmap

Fabric is moving from an internal prototype to a publishable product line under the `@fenglimg/fabric-*` scope. This roadmap is organized as a three-phase SemVer plan so the public contract, implementation status, and release gates stay aligned.

## v1.0

- theme: `Control Plane MVP`
- focus: ship the smallest trustworthy control plane that lets a maintainer initialize a repo, inspect it, and start a guarded local session with one install path.
- release_signal: `npm publish @fenglimg/fabric-cli@1.0.0` succeeds; a clean-project `fab init -> fab serve` smoke test passes without manual file edits.

### Scope

1. `fab init` writes the minimum protocol skeleton into a repository.
2. `fab scan` and related CLI inspection flows generate evidence before AI-assisted setup.
3. MCP runtime dispatch is available through the packaged server path.
4. `fab serve` provides the first local control-plane session for maintainers.
5. Core docs stay consistent with the first public npm release under `@fenglimg/fabric-*`.

## v1.1

- theme: `Observable Maintenance`
- focus: make the system inspectable after adoption so maintainers can diagnose drift, observe state, and recover trust without reading raw ledger files by hand.
- release_signal: after `fab serve`, the Dashboard is reachable at `http://localhost:3333`, loads project state successfully, and can inspect ledger/rules data in one local smoke test.

### Features

1. Feature #5: Dashboard
   Web UI for ledger and rules inspection, launched by `fab serve`, with the Dashboard explicitly locked to the v1.1 milestone.
2. Feature #1: `drift-check`
   Warn when implementation activity has likely moved ahead of AGENTS.md or other human-maintained protocol surfaces.
3. Feature #2: `fab migrate`
   Upgrade `.fabric/` metadata safely when schema versions change over time.
4. Feature #3: `fab doctor`
   Diagnose installation, hook, config, and client-integration problems across supported AI clients.
5. Feature #4: Copilot fallback compile
   Flatten the structured protocol into `.github/copilot-instructions.md` if GitHub Copilot becomes a viable secondary target.

## v1.2

- theme: `Portability & Trust`
- focus: make Fabric releasable, auditable, and portable across providers without using the roadmap itself as a changelog surrogate.
- release_signal: a tag push auto-generates a new `CHANGELOG.md` entry, follows the documented `RELEASING.md` workflow, and keeps published packages isolated to the `@fenglimg/fabric-*` scope.

### Scope

1. Add `CHANGELOG.md` governance so released behavior is tracked outside the roadmap.
2. Add `RELEASING.md` with build, tag, publish, rollback, and smoke-test policy.
3. Enforce scope isolation so public packages ship only as `@fenglimg/fabric-*` and version drift is blocked in CI.
4. Strengthen multi-provider trust with explicit release checks for CLI, MCP, and Dashboard surfaces.
5. Keep roadmap promises separate from released artifacts, with measurable release gates instead of aspirational notes.
