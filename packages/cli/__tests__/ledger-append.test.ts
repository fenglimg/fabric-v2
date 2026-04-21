import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];
const originalIntent = process.env.FABRIC_INTENT;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  if (originalIntent === undefined) {
    delete process.env.FABRIC_INTENT;
  } else {
    process.env.FABRIC_INTENT = originalIntent;
  }

  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

describe("ledger-append command", () => {
  it("ignores trailing mcp-event lines when checking for duplicate human entries", async () => {
    const target = createFixtureRoot("ledger-append");
    const ledgerPath = join(target, ".intent-ledger.jsonl");

    process.env.FABRIC_INTENT = "dedupe check";

    writeFileSync(
      ledgerPath,
      `${JSON.stringify({
        ts: 1_000,
        source: "human",
        parent_sha: "abc123",
        intent: "dedupe check",
        affected_paths: ["src/foo.ts"],
        diff_stat: " src/foo.ts | 1 +\n 1 file changed, 1 insertion(+)\n",
      })}\n${JSON.stringify({
        kind: "mcp-event",
        eventId: "evt-1",
        streamId: "stream-1",
        message: { jsonrpc: "2.0", method: "notifications/message" },
      })}\n`,
      "utf8",
    );

    vi.doMock("node:child_process", () => ({
      execSync: vi.fn((command: string) => {
        if (command === "git diff --cached --name-only --no-renames") {
          return "src/foo.ts\n";
        }

        if (command === "git diff --cached --stat") {
          return " src/foo.ts | 1 +\n 1 file changed, 1 insertion(+)\n";
        }

        if (command === "git rev-parse --short HEAD") {
          return "abc123\n";
        }

        if (command === "git add .intent-ledger.jsonl") {
          return "";
        }

        throw new Error(`Unexpected git command: ${command}`);
      }),
    }));

    const command = (await import("../src/commands/ledger-append.js")).default;
    await command.run?.({ args: { target, staged: true } } as never);

    expect(readFileSync(ledgerPath, "utf8").trim().split(/\r?\n/)).toHaveLength(2);
  });
});

function createFixtureRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(root);
  return root;
}
