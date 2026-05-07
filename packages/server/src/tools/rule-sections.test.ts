import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { registerRuleSections } from "./rule-sections.js";

describe("registerRuleSections", () => {
  it("validates selection token, AI-selected stable ids, selection reasons, and section names", () => {
    const registerTool = vi.fn();

    registerRuleSections({
      registerTool,
    } as unknown as McpServer);

    // inputSchema is now a full z.object — access fields via .shape
    const definition = registerTool.mock.calls[0]?.[1] as {
      inputSchema: z.ZodObject<{
        selection_token: z.ZodString;
        sections: z.ZodArray<z.ZodEnum<[string, ...string[]]>>;
        ai_selected_stable_ids: z.ZodArray<z.ZodString>;
        ai_selection_reasons: z.ZodRecord<z.ZodString>;
      }>;
    };

    const shape = definition.inputSchema.shape;

    expect(shape.selection_token.safeParse("selection:rev:abc").success).toBe(true);
    expect(shape.sections.safeParse([
      "MISSION_STATEMENT",
      "MANDATORY_INJECTION",
      "BUSINESS_LOGIC_CHUNKS",
      "CONTEXT_INFO",
    ]).success).toBe(true);
    expect(shape.sections.safeParse(["UNKNOWN"]).success).toBe(false);
    expect(shape.ai_selected_stable_ids.safeParse(["ui-batch-rendering"]).success).toBe(true);
    expect(shape.ai_selection_reasons.safeParse({
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
