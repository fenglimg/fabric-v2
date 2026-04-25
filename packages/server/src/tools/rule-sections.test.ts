import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { registerRuleSections } from "./rule-sections.js";

describe("registerRuleSections", () => {
  it("validates selection token, AI-selected stable ids, selection reasons, and section names", () => {
    const registerTool = vi.fn();

    registerRuleSections({
      registerTool,
    } as unknown as McpServer);

    const definition = registerTool.mock.calls[0]?.[1] as {
      inputSchema: {
        selection_token: { safeParse: (value: unknown) => { success: boolean } };
        sections: { safeParse: (value: unknown) => { success: boolean } };
        ai_selected_stable_ids: { safeParse: (value: unknown) => { success: boolean } };
        ai_selection_reasons: { safeParse: (value: unknown) => { success: boolean } };
      };
    };

    expect(definition.inputSchema.selection_token.safeParse("selection:rev:abc").success).toBe(true);
    expect(definition.inputSchema.sections.safeParse(["MANDATORY_INJECTION", "CONTEXT_INFO"]).success).toBe(true);
    expect(definition.inputSchema.sections.safeParse(["UNKNOWN"]).success).toBe(false);
    expect(definition.inputSchema.ai_selected_stable_ids.safeParse(["ui-batch-rendering"]).success).toBe(true);
    expect(definition.inputSchema.ai_selection_reasons.safeParse({
      "ui-batch-rendering": "Selected because target touches UI rendering.",
    }).success).toBe(true);
  });

  it("registers fab_get_rule_sections", () => {
    const registerTool = vi.fn();

    registerRuleSections({
      registerTool,
    } as unknown as McpServer);

    expect(registerTool.mock.calls[0]?.[0]).toBe("fab_get_rule_sections");
  });
});
