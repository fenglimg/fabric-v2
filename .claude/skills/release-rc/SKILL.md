---
name: release-rc
description: Use this skill to cut a new Fabric v2 release candidate (v2.x.0-rc.N — the minor is derived from the latest tag, never pinned to 2.0.0). Drives the full sequence — version bump across root + workspaces, version-sync verification, `fab -v` check, typecheck/lint/test gates, commit, tag, push, and CI watch — to prevent the fix-forward cascades (rc.7, rc.12→rc.13) and version-desync bug (root rc.18 vs packages rc.19) that have happened before. Invoke only when the user explicitly asks to release / cut / tag / publish a new rc.
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
# Last rc tag on the v2 line — match ANY minor (2.0 / 2.1 / 2.3 / …), newest first.
LAST_TAG=$(git tag --sort=-creatordate | grep -E '^v2\.[0-9]+\.0-rc\.' | head -1)
# Next rc = SAME minor line, trailing rc number + 1. Derive it — never assume 2.0.0.
BASE="${LAST_TAG%-rc.*}"          # e.g. v2.3.0
LAST_N="${LAST_TAG##*-rc.}"       # e.g. 4
NEXT_TAG="${BASE}-rc.$((LAST_N + 1))"
echo "Last tag: $LAST_TAG  ->  Proposed next: $NEXT_TAG"
# Current versions (root + every workspace package)
node -e "console.log(require('./package.json').version)"
for f in packages/*/package.json; do node -e "const p=require('./$f'); console.log('$f', p.version)"; done
```

Report to the user (use the derived `$LAST_TAG` / `$NEXT_TAG` values — do NOT hardcode the minor):

- Last tag: `$LAST_TAG` (e.g. `v2.3.0-rc.4`)
- Root version: `…`
- Each workspace version: `…`
- **Proposed next: `$NEXT_TAG` (= last tag's rc number + 1, same minor line) — theme: ?**

Ask the user for:
- Confirmation of the next rc number (default = last tag's rc number + 1, same minor).
- A short theme word for the bump commit subject (matches the existing `chore(rcN): bump to v<MAJOR.MINOR>.0-rc.N — <theme>` pattern, e.g. "Protocol v2", "Polish", "bootstrap consolidation").

Do NOT proceed until the user confirms both.

## Phase 2 — Version bump (atomic)

Bump root + every workspace package to the same version in one batch.

```bash
# Use the version the user just confirmed in Phase 1 (the next tag minus its leading `v`).
# Derive it — NEVER hardcode 2.0.0. e.g. next tag v2.3.0-rc.5  ->  NEW_VERSION="2.3.0-rc.5"
NEW_VERSION="${NEXT_TAG#v}"   # reuses $NEXT_TAG from Phase 1; or set the confirmed value explicitly
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

Then **runtime version check** (catches the `fab -v` reporting a stale version instead of the just-bumped rc):

```bash
pnpm -C packages/cli build       # or whatever produces the CLI binary
node packages/cli/dist/<entry>.js -v   # confirm output exactly equals $NEW_VERSION
# (If a global `fab` is linked, also run: fab -v)
```

The check is simply: `fab -v` output **must exactly equal `$NEW_VERSION`** (the version you bumped in Phase 2). If it does not, abort. Investigate where the version is read from — historically this was a stale embedded string.

## Phase 4 — Commit, tag, push

Only after every gate above is green:

```bash
# $NEW_VERSION / $NEXT_TAG carry over from Phase 1–2 (e.g. 2.3.0-rc.5 / v2.3.0-rc.5). Never hardcode 2.0.0.
RC_N="${NEW_VERSION##*-rc.}"      # the rc number, e.g. 5
git add package.json packages/*/package.json pnpm-lock.yaml
git commit -m "chore(rc${RC_N}): bump to ${NEXT_TAG} — <theme>"
git tag "${NEXT_TAG}"
git push origin <branch>
git push origin "${NEXT_TAG}"
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
| `fab -v` desync | version string embedded at build time, not read from `package.json` | grep `packages/cli/src` for the previous rc string (derive it from the last tag — never a hardcoded version) |

## Things this skill must NEVER do

- Skip a gate because "it's a small change".
- Use `git commit --amend` to fix a botched bump — always cut the next rc instead.
- Force-push the release branch.
- Run `npm publish` / `pnpm publish` — publishing is CI's job in this repo.
- Auto-release after a feature commit without an explicit user request.
