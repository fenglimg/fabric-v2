# Day 4 Pre-commit Pipeline Test

This test plan verifies the Day 4 pre-commit triple:

1. `fab sync-meta --check-only`
2. `fab human-lint`
3. `fab ledger-append --staged`

It also verifies the `.fabric/agents.meta.json` manual-edit guard and the `<300ms` timing target on a trivial diff.

## Prerequisites

- Run from the Fabric repository root.
- Build the CLI before testing: `pnpm --filter @fenglimg/fabric-cli build`
- Use a disposable local repository for the hook checks.

## Scenario A: Fresh Repo Passes and Appends Ledger

1. Create a temporary repository and initialize it:

   ```bash
   mkdir /tmp/fabric-day4
   cd /tmp/fabric-day4
   git init
   printf '{\n  "name": "fabric-day4",\n  "private": true\n}\n' > package.json
   node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js init --target .
   node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js hooks install --target .
   printf 'demo\n' > README.md
   git add .
   ```

2. Run the hook directly:

   ```bash
   ./.husky/pre-commit
   ```

3. Expected results:
   - Exit code is `0`.
   - `.intent-ledger.jsonl` exists.
   - `git diff --cached --name-only` includes `.intent-ledger.jsonl`.

4. Expected terminal output:

   ```text
   Installed /tmp/fabric-day4/.husky/pre-commit
   Added prepare script to /tmp/fabric-day4/package.json
   ```

5. Inspect the ledger:

   ```bash
   cat .intent-ledger.jsonl
   ```

6. Expected JSON line shape:

   ```json
   {"ts":1713410000000,"parent_sha":"root","intent":"auto: README.md","affected_paths":["README.md"],"diff_stat":" README.md | 1 +\n 1 file changed, 1 insertion(+)"}
   ```

## Scenario B: Locked Human Section Drift Blocks Commit

1. Replace `.fabric/human-lock.json` with a real lock entry that targets `AGENTS.md`:

   ```bash
   node <<'EOF'
   const { createHash } = require("node:crypto");
   const { readFileSync, writeFileSync } = require("node:fs");
   const content = readFileSync("AGENTS.md", "utf8").split(/\r?\n/).slice(16, 20).join("\n");
   const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
   writeFileSync(".fabric/human-lock.json", JSON.stringify({
     $schema: "https://fabric.local/schemas/human-lock.json",
     locked: [{ file: "AGENTS.md", start_line: 17, end_line: 20, hash }],
     examples: []
   }, null, 2) + "\n");
   EOF
   git add .fabric/human-lock.json AGENTS.md
   ```

2. Edit one line inside the locked range, then stage it:

   ```bash
   perl -0pi -e 's/AI must not rewrite locked sentences\./AI must never rewrite locked sentences./' AGENTS.md
   git add AGENTS.md
   ./.husky/pre-commit
   ```

3. Expected result:
   - Exit code is `1`.
   - Commit is blocked before `ledger-append`.

4. Expected terminal output includes:

   ```text
   Human-locked content drift detected. Revert the edit or update approved hashes before committing.
   Location                         Expected            Got
   AGENTS.md:17-20                 sha256:...          sha256:...
   ```

## Scenario C: Manual `agents.meta.json` Edit Is Blocked

1. Edit `.fabric/agents.meta.json` directly and stage it:

   ```bash
   perl -0pi -e 's/"priority": "high"/"priority": "low"/' .fabric/agents.meta.json
   git add .fabric/agents.meta.json
   ./.husky/pre-commit
   ```

2. Expected result without override:
   - Exit code is `1`.
   - The guard message is printed to `stderr`.

3. Expected terminal output:

   ```text
   .fabric/agents.meta.json cannot be manually edited; use fab_update_registry
   ```

4. Override check:

   ```bash
   FAB_ALLOW_META_EDIT=1 ./.husky/pre-commit
   ```

5. Expected override result:
   - Hook continues past the guard.
   - If no other drift exists, exit code is `0`.

## Scenario D: Timing Budget Stays Under 300ms

1. Reset to a trivial staged diff:

   ```bash
   git reset
   printf 'tiny\n' >> README.md
   git add README.md
   ```

2. Measure the hook runtime:

   ```bash
   time ./.husky/pre-commit
   ```

3. Expected result:
   - Total wall-clock time should stay below `0.300s` on a trivial diff on a warmed local machine.

4. Expected `time` output shape:

   ```text
   real    0m0.2xxs
   user    0m0.xxxs
   sys     0m0.xxxs
   ```

## Notes

- `ledger-append` uses `parent_sha: "root"` on the first commit because `HEAD` does not exist yet.
- If Scenario C fails early with `meta drift; run: fab sync-meta`, run `fab sync-meta`, restage `.fabric/agents.meta.json`, and rerun the guard check.
- The hook template is written with mode `755` by `fab hooks install`; no manual `chmod` step is required after installation.
