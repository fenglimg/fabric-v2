import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerExtractKnowledge } from "./extract-knowledge.js";
import type { InFlightTracker } from "../services/in-flight-tracker.js";

type RegisteredTool = {
  name: string;
  definition: { inputSchema: unknown; outputSchema: unknown; annotations: unknown };
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: { pending_path: string; idempotency_key: string };
  }>;
};

const tempDirs: string[] = [];
let originalProjectRoot: string | undefined;

beforeEach(() => {
  originalProjectRoot = process.env.FABRIC_PROJECT_ROOT;
});

afterEach(async () => {
  if (originalProjectRoot === undefined) {
    delete process.env.FABRIC_PROJECT_ROOT;
  } else {
    process.env.FABRIC_PROJECT_ROOT = originalProjectRoot;
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

describe("registerExtractKnowledge", () => {
  it("registers fab_extract_knowledge with correct name and schemas", () => {
    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();
    expect(t.name).toBe("fab_extract_knowledge");
    expect(t.definition.inputSchema).toBeDefined();
    expect(t.definition.outputSchema).toBeDefined();
    expect(t.definition.annotations).toBeDefined();
  });

  it("invokes extractKnowledge service end-to-end and returns structured content", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-extract-"));
    tempDirs.push(projectRoot);
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    const result = await t.handler({
      source_session: "sess-tool-001",
      recent_paths: ["packages/server/src/index.ts"],
      user_messages_summary: "Tool-handler integration: write through to pending.",
      type: "decisions",
      slug: "tool-handler-coverage",
    });

    expect(result.structuredContent.pending_path).toBe(
      ".fabric/knowledge/pending/decisions/tool-handler-coverage.md",
    );
    expect(result.structuredContent.idempotency_key).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    // text mirrors structuredContent
    const textParsed = JSON.parse(result.content[0]!.text) as {
      pending_path: string;
      idempotency_key: string;
    };
    expect(textParsed).toEqual(result.structuredContent);
  });

  it("calls tracker.enter and tracker.exit around the handler invocation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-extract-"));
    tempDirs.push(projectRoot);
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server, tracker);
    const t = tool();

    await t.handler({
      source_session: "sess-tracker",
      recent_paths: [],
      user_messages_summary: "Tracker exercises enter/exit on success.",
      type: "guidelines",
      slug: "tracker-enter-exit",
    });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    // Both calls receive the same request id (a UUID string).
    const enterId = enter.mock.calls[0]?.[0];
    const exitId = exit.mock.calls[0]?.[0];
    expect(typeof enterId).toBe("string");
    expect(enterId).toBe(exitId);
  });

  it("calls tracker.exit even if the underlying service throws", async () => {
    // Force resolveProjectRoot() to point at a path that is unwriteable so
    // ensureParentDirectory throws inside extractKnowledge — we still want
    // tracker.exit() to fire (the tool body wraps the call in try/finally).
    process.env.FABRIC_PROJECT_ROOT = "/nonexistent-readonly-path-fabric-tools-test";

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server, tracker);
    const t = tool();

    await expect(
      t.handler({
        source_session: "sess-throw",
        recent_paths: [],
        user_messages_summary: "Forces a failure path.",
        type: "decisions",
        slug: "force-throw",
      }),
    ).rejects.toBeDefined();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("works without a tracker (optional argument)", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-extract-"));
    tempDirs.push(projectRoot);
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server); // no tracker
    const t = tool();

    const result = await t.handler({
      source_session: "sess-no-tracker",
      recent_paths: [],
      user_messages_summary: "Verifies the optional-tracker branch.",
      type: "guidelines",
      slug: "no-tracker-branch",
    });
    expect(result.structuredContent.pending_path).toMatch(/no-tracker-branch\.md$/u);
  });
});
