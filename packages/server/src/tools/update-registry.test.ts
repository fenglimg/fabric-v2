import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { registerUpdateRegistry } from "./update-registry.js";

describe("registerUpdateRegistry", () => {
  it("accepts enum priorities and rejects numeric priorities", () => {
    const registerTool = vi.fn();

    registerUpdateRegistry({
      registerTool,
    } as unknown as McpServer);

    const definition = registerTool.mock.calls[0]?.[1] as {
      inputSchema: {
        data: {
          safeParse: (value: unknown) => { success: boolean };
        };
      };
    };

    expect(
      definition.inputSchema.data.safeParse({
        file: ".fabric/agents/example.md",
        scope_glob: "src/**",
        deps: [],
        priority: "high",
        hash: "sha256:test",
      }).success,
    ).toBe(true);
    expect(
      definition.inputSchema.data.safeParse({
        file: ".fabric/agents/example.md",
        scope_glob: "src/**",
        priority: 2,
      }).success,
    ).toBe(false);
  });
});
