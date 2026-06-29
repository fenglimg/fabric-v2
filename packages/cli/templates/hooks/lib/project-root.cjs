#!/usr/bin/env node
/**
 * Shared project-root resolver for all Fabric hooks.
 *
 * Why this exists: every hook writes telemetry / cache / injection ledgers
 * under `<projectRoot>/.fabric/`. Historically each hook derived that root
 * from `process.cwd()` at the `require.main` entrypoint. But a hook's cwd is
 * the *session's* working directory, which is frequently a SUBDIRECTORY of
 * the repo (the user `cd`'d in, or a delegate/explore subprocess ran with
 * `--cd packages/cli/...`). The unconditional `mkdirSync` in injection-log /
 * state-store / session-digest-writer then created a brand-new stray
 * `.fabric/` inside that subdirectory instead of writing to the real repo
 * `.fabric/` — scattering `events.jsonl` / `metrics.jsonl` / `.cache` across
 * the source tree.
 *
 * Resolution order (first match wins):
 *   1. `CLAUDE_PROJECT_DIR` — Claude Code always injects the authoritative
 *      project root (the same var `.claude/settings.json` uses to locate
 *      these hook scripts). Codex does not set it, hence step 2.
 *   2. Walk up from the start cwd to the nearest ancestor holding a `.git`
 *      marker — the authoritative repo root, and crucially IMMUNE to the
 *      stray `.fabric/` subdirectories this resolver exists to prevent
 *      (a `.fabric/` left in a subdir must NOT capture the walk). In the
 *      dual-root layout (KT-DEC-0003) `<repo>/.fabric` sits AT the git root,
 *      so the two coincide. Client-agnostic; covers Codex and custom launchers.
 *   3. No `.git` anywhere up the chain (a non-git Fabric project): use the
 *      nearest pre-existing `.fabric/` anchor instead.
 *   4. Fall back to the start cwd unchanged (fresh project with no marker yet
 *      — same behaviour as before, so a brand-new repo still bootstraps).
 *
 * Pure + side-effect free (only `existsSync` reads). Hooks call this ONLY at
 * their real CLI entrypoint; the in-process `(env && env.cwd) || ...` paths
 * that tests exercise stay untouched.
 */
const { existsSync } = require("node:fs");
const { join, dirname } = require("node:path");

function resolveProjectRoot(startCwd) {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (typeof envRoot === "string" && envRoot.length > 0) return envRoot;

  const start = typeof startCwd === "string" && startCwd.length > 0 ? startCwd : process.cwd();
  let dir = start;
  let firstFabric = null;
  // Bound the climb defensively — a real repo is found in a handful of hops;
  // the cap only guards against pathological symlink/mount loops.
  for (let i = 0; i < 64; i++) {
    // .git wins: it is the repo-root anchor a stray .fabric subdir can't fake.
    if (existsSync(join(dir, ".git"))) return dir;
    if (firstFabric === null && existsSync(join(dir, ".fabric"))) firstFabric = dir;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return firstFabric || start;
}

module.exports = { resolveProjectRoot };
