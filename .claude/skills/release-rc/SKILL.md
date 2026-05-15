---
name: release-rc
description: Use this skill to cut a new Fabric v2 release candidate (v2.0.0-rc.N). Drives the full sequence — version bump across root + workspaces, version-sync verification, `fab -v` check, typecheck/lint/test gates, commit, tag, push, and CI watch — to prevent the fix-forward cascades (rc.7, rc.12→rc.13) and version-desync bug (root rc.18 vs packages rc.19) that have happened before. Invoke only when the user explicitly asks to release / cut / tag / publish a new rc.
allowed-tools: Read, Glob, Grep, Bash, Edit
---

## When to invoke

Trigger phrases: "release rc", "cut rc", "tag rc", "发个 rc", "出 rc.N", "publish rc".

If the user is mid-feature work and has NOT asked to release, stop and ask first. Do not auto-release after a feature lands.

## Hard preconditions (abort if any fail)

Run all checks before proposing anything:

1. `git rev-parse --abbrev-ref HEAD` — must be `main` (or whatever the user confirms is the release branch).
2. `git status --porcelain` — must be empty. No uncommitted changes.
3. `git fetch && git status` — must report up-to-date with `origin/<branch>`. Refuse to release ahead of unpushed commits or behind remote.
4. `gh auth status` — must be authenticated (we'll need `gh run watch` later).

If any fail, surface the failure and stop — do NOT try to "fix" it (commit/stash/pull) without the user saying so.

## Phase 1 — Determine next rc

```bash
# Last tag
git tag --sort=-creatordate | grep '^v2\.0\.0-rc\.' | head -1
# Current versions (root + every workspace package)
node -e "console.log(require('./package.json').version)"
for f in packages/*/package.json; do node -e "const p=require('./$f'); console.log('$f', p.version)"; done
```

Report to the user:

- Last tag: `v2.0.0-rc.X`
- Root version: `…`
- Each workspace version: `…`
- **Proposed next: `v2.0.0-rc.<X+1>` (theme: ?)**

Ask the user for:
- Confirmation of the next rc number (default = last tag + 1).
- A short theme word for the bump commit subject (matches the existing `chore(rcN): bump to v2.0.0-rc.N — <theme>` pattern, e.g. "Protocol v2", "Polish", "bootstrap consolidation").

Do NOT proceed until the user confirms both.

## Phase 2 — Version bump (atomic)

Bump root + every workspace package to the same version in one batch.

```bash
NEW_VERSION="2.0.0-rc.<N>"
# Root
npm pkg set version="$NEW_VERSION"
# Workspaces
for f in packages/*/package.json; do (cd $(dirname $f) && npm pkg set version="$NEW_VERSION"); done
```

Then **verify sync** (this is the guardrail for the historical desync bug):

```bash
node -e "
const root = require('./package.json').version;
const pkgs = require('fs').readdirSync('packages').map(d => ({d, v: require('./packages/'+d+'/package.json').version}));
const mismatch = pkgs.filter(p => p.v !== root);
if (mismatch.length) { console.error('VERSION DESYNC:', root, 'vs', mismatch); process.exit(1); }
console.log('All versions synced at', root);
"
```

If the verifier exits non-zero, abort — do not commit.

## Phase 3 — Gates (run, do not skip)

Run each in order. Report output to the user. Any failure aborts.

```bash
pnpm install --frozen-lockfile   # ensures lockfile reflects new versions if applicable
pnpm -r --if-present typecheck   # if no typecheck script, run: pnpm -r exec tsc --noEmit
pnpm lint                        # = knip --strict, this is the rc.12 failure class
pnpm test                        # full workspace tests
```

Then **runtime version check** (catches the `fab -v` showing 2.0.0 instead of rc.N bug):

```bash
pnpm -C packages/cli build       # or whatever produces the CLI binary
node packages/cli/dist/<entry>.js -v   # confirm output matches NEW_VERSION
# (If a global `fab` is linked, also run: fab -v)
```

If `fab -v` output does not exactly equal `$NEW_VERSION`, abort. Investigate where the version is read from — historically this was a stale embedded string.

## Phase 4 — Commit, tag, push

Only after every gate above is green:

```bash
git add package.json packages/*/package.json pnpm-lock.yaml
git commit -m "chore(rc<N>): bump to v2.0.0-rc.<N> — <theme>"
git tag "v2.0.0-rc.<N>"
git push origin <branch>
git push origin "v2.0.0-rc.<N>"
```

Show the user the resulting commit + tag and pause for them to confirm before pushing if they prefer — when in doubt, prefer asking.

## Phase 5 — CI watch

```bash
gh run watch --exit-status
```

- Green → done. Report tag URL.
- Red → do NOT auto-fix-forward. Pull the failed job log, classify the failure (one of: `tsc`, `knip`, `coverage`, `lint`, `test`, `build`, `unknown`), and present:
  - failure class
  - the specific failing command
  - 2–3 sentence root-cause hypothesis
  - proposed next step (revert tag, or prepare rc.<N+1> fix-forward)
  Then stop and wait for the user to choose.

## Failure-class quick reference

| Class | Typical cause in this repo | First check |
|---|---|---|
| `knip` failure | unused export / stale entry not in `knip.json` | `pnpm lint` locally, inspect knip ignores |
| `tsc` failure | stale import after rename refactor | check files changed since last green rc |
| `coverage` failure | deleted/moved fixture, missing test for new code path | inspect `scripts/rc*-coverage-gate.mjs` output |
| `fab -v` desync | version string embedded at build time, not read from `package.json` | grep for the previous rc string in `packages/cli/src` |

## Things this skill must NEVER do

- Skip a gate because "it's a small change".
- Use `git commit --amend` to fix a botched bump — always cut the next rc instead.
- Force-push the release branch.
- Run `npm publish` / `pnpm publish` — publishing is CI's job in this repo.
- Auto-release after a feature commit without an explicit user request.
