import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerReview } from "./review.js";
import type { InFlightTracker } from "../services/in-flight-tracker.js";

type RegisteredTool = {
  name: string;
  definition: { inputSchema: unknown; outputSchema: unknown; annotations: unknown };
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: unknown;
  }>;
};

const tempDirs: string[] = [];
let originalProjectRoot: string | undefined;
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalProjectRoot = process.env.FABRIC_PROJECT_ROOT;
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-tools-review-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalProjectRoot === undefined) {
    delete process.env.FABRIC_PROJECT_ROOT;
  } else {
    process.env.FABRIC_PROJECT_ROOT = originalProjectRoot;
  }
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

function captureRegistration(): { tool: () => RegisteredTool; server: McpServer } {
  let captured: RegisteredTool | undefined;
  const registerTool = vi.fn(
    (name: string, definition: RegisteredTool["definition"], handler: RegisteredTool["handler"]) => {
      captured = { name, definition, handler };
    },
  );
  const server = { registerTool } as unknown as McpServer;
  return {
    server,
    tool: () => {
      if (captured === undefined) {
        throw new Error("tool not registered");
      }
      return captured;
    },
  };
}

async function seedPendingFile(
  projectRoot: string,
  type: "decisions" | "guidelines" | "pitfalls",
  slug: string,
): Promise<string> {
  const dir = join(projectRoot, ".fabric", "knowledge", "pending", type);
  await mkdir(dir, { recursive: true });
  const frontmatter = [
    "---",
    `type: ${type}`,
    "maturity: draft",
    "layer: team",
    `created_at: ${new Date().toISOString()}`,
    "source_session: sess-tool-review",
    "tags: []",
    "x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "---",
    "",
    "## Summary",
    "",
    "Body text.",
    "",
  ].join("\n");
  const relativePath = `.fabric/knowledge/pending/${type}/${slug}.md`;
  await writeFile(join(projectRoot, relativePath), frontmatter, "utf8");
  execFileSync("git", ["add", relativePath], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["commit", "--quiet", "-m", `seed: ${slug}`], { cwd: projectRoot, stdio: "pipe" });
  return relativePath;
}

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-review-"));
  tempDirs.push(projectRoot);
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Fabric Tests"], { cwd: projectRoot, stdio: "pipe" });
  return projectRoot;
}

describe("registerReview", () => {
  it("registers fab_review with correct name and schemas", () => {
    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();
    expect(t.name).toBe("fab_review");
    expect(t.definition.inputSchema).toBeDefined();
    expect(t.definition.outputSchema).toBeDefined();
    expect(t.definition.annotations).toBeDefined();
  });

  it("invokes reviewKnowledge end-to-end (list action) and returns structured content", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    await seedPendingFile(projectRoot, "decisions", "tool-list-target");

    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    const result = await t.handler({ action: "list" });
    expect(result.structuredContent).toMatchObject({ action: "list" });
    expect(Array.isArray((result.structuredContent as { items: unknown }).items)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    const parsed = JSON.parse(result.content[0]!.text) as { action: string };
    expect(parsed.action).toBe("list");
  });

  it("calls tracker.enter and tracker.exit around the handler invocation", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerReview(server, tracker);
    const t = tool();

    await t.handler({ action: "list" });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    const enterId = enter.mock.calls[0]?.[0];
    const exitId = exit.mock.calls[0]?.[0];
    expect(typeof enterId).toBe("string");
    expect(enterId).toBe(exitId);
  });

  it("calls tracker.exit even if the underlying service throws", async () => {
    // Use a modify action against a missing path — service throws.
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerReview(server, tracker);
    const t = tool();

    await expect(
      t.handler({
        action: "modify",
        pending_path: ".fabric/knowledge/pending/decisions/no-such-file.md",
        changes: { maturity: "verified" },
      }),
    ).rejects.toBeDefined();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("works without a tracker (optional argument)", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerReview(server); // no tracker
    const t = tool();

    const result = await t.handler({ action: "list" });
    expect((result.structuredContent as { action: string }).action).toBe("list");
  });
});
