import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// Codex client detection.
//
// `~/.codex` only appears after Codex has been RUN at least once — installing
// the CLI does not create it. Gating detection on that directory alone meant a
// teammate who installed Fabric before first launching Codex got hooks + skills
// written into `<project>/.codex/` but no `[mcp_servers.fabric]` anywhere, with
// no error and no warning: `resolveClients` skipped the writer, and
// `CodexTOMLConfigWriter.detect()` independently returned null so `write()`
// no-opped. Two gates, both silent.
//
// The binary on PATH is the earlier and more truthful signal — it exists from
// the moment Codex is installed. Checking it does NOT widen detection to
// machines without Codex, which is why this is not the `existsSync(<workspace>/.codex)`
// arm that Claude Code uses: `<workspace>/.codex` is written by Fabric itself,
// so that arm is self-fulfilling and would fabricate a client for every user.
const CODEX_BINARY_NAMES = ["codex", "codex.exe", "codex.cmd", "codex.bat"] as const;

export type CodexDetectionDeps = {
  home?: string;
  pathEnv?: string | undefined;
};

/** True when Codex appears installed on this machine (run-once dir OR binary on PATH). */
export function isCodexInstalled(deps: CodexDetectionDeps = {}): boolean {
  const home = deps.home ?? homedir();
  if (existsSync(join(home, ".codex"))) {
    return true;
  }
  return hasCodexBinaryOnPath(deps.pathEnv ?? process.env.PATH);
}

// PATH is scanned directly rather than shelling out to `which` / `where`: a
// subprocess per install stage is both slower and untestable without a real
// binary on the runner.
function hasCodexBinaryOnPath(pathEnv: string | undefined): boolean {
  if (pathEnv === undefined || pathEnv.length === 0) {
    return false;
  }
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const name of CODEX_BINARY_NAMES) {
      if (existsSync(join(dir, name))) {
        return true;
      }
    }
  }
  return false;
}
