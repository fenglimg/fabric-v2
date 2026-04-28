import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { HistoryReplayError, rehydrateAgentsMetaAt } from "./rehydrate-state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("rehydrateAgentsMetaAt", () => {
  it("rehydrates agents meta from git history for a selected ledger entry", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });

    await writeFile(join(projectRoot, ".fabric", "agents.meta.json"), JSON.stringify({
      revision: "rev-a",
      nodes: {
        "src/a.ts": {
          file: "src/a.ts",
          scope_glob: "src/a.ts",
          deps: [],
          priority: "high",
          hash: "sha256:a",
        },
      },
    }, null, 2));
    git(projectRoot, "init");
    git(projectRoot, "config", "user.email", "tests@example.com");
    git(projectRoot, "config", "user.name", "Fabric Tests");
    git(projectRoot, "add", ".fabric/agents.meta.json");
    git(projectRoot, "commit", "-m", "meta a");
    const commitA = git(projectRoot, "rev-parse", "--short", "HEAD").trim();

    await writeFile(join(projectRoot, ".fabric", "agents.meta.json"), JSON.stringify({
      revision: "rev-b",
      nodes: {
        "src/a.ts": {
          file: "src/a.ts",
          scope_glob: "src/a.ts",
          deps: [],
          priority: "high",
          hash: "sha256:a",
        },
        "src/b.ts": {
          file: "src/b.ts",
          scope_glob: "src/b.ts",
          deps: ["src/a.ts"],
          priority: "medium",
          hash: "sha256:b",
        },
      },
    }, null, 2));
    git(projectRoot, "add", ".fabric/agents.meta.json");
    git(projectRoot, "commit", "-m", "meta b");
    const commitB = git(projectRoot, "rev-parse", "--short", "HEAD").trim();

    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), [
      JSON.stringify({
        id: "ledger:a",
        ts: 10,
        source: "ai",
        commit_sha: commitA,
        intent: "create a",
        affected_paths: ["src/a.ts"],
      }),
      JSON.stringify({
        kind: "mcp-event",
        eventId: "evt-1",
        streamId: "stream-1",
        message: { jsonrpc: "2.0", method: "ping" },
      }),
      JSON.stringify({
        id: "ledger:b",
        ts: 20,
        source: "ai",
        commit_sha: commitB,
        intent: "create b",
        affected_paths: ["src/b.ts"],
      }),
    ].join("\n"));

    const result = await rehydrateAgentsMetaAt(projectRoot, { ledgerEntryId: "ledger:b" });

    expect(result.metadata).toMatchObject({
      at_ledger_id: "ledger:b",
      at_commit: commitB,
      replayed_count: 2,
      mode: "git-show",
    });
    expect(result.meta.revision).toBe("rev-b");
    expect(Object.keys(result.meta.nodes)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("falls back to a ledger-derived snapshot when git history cannot be resolved", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), `${JSON.stringify({
      id: "ledger:fallback",
      ts: 30,
      source: "ai",
      commit_sha: "deadbeef",
      intent: "touch dashboard",
      affected_paths: ["packages/dashboard/src/views/timeline.tsx"],
    })}\n`);

    const result = await rehydrateAgentsMetaAt(projectRoot, { timestamp: 30 });

    expect(result.metadata).toMatchObject({
      at_ledger_id: "ledger:fallback",
      at_commit: "deadbeef",
      replayed_count: 1,
      mode: "ledger-fallback",
    });
    expect(result.meta.nodes["packages/dashboard/src/views/timeline.tsx"]).toMatchObject({
      file: "packages/dashboard/src/views/timeline.tsx",
      scope_glob: "packages/dashboard/src/views/timeline.tsx",
      priority: "medium",
    });
  });

  it("throws a not-found error when no ledger entry exists at the requested time", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", ".intent-ledger.jsonl"), `${JSON.stringify({
      id: "ledger:late",
      ts: 100,
      source: "human",
      parent_sha: "root",
      intent: "annotate",
      affected_paths: ["README.md"],
      diff_stat: "1 file changed",
    })}\n`);

    await expect(rehydrateAgentsMetaAt(projectRoot, { timestamp: 50 })).rejects.toMatchObject({
      code: "HISTORY_STATE_NOT_FOUND",
      status: 404,
    });
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-history-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function git(projectRoot: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
