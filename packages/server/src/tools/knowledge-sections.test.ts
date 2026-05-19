import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { registerKnowledgeSections } from "./knowledge-sections.js";

describe("registerKnowledgeSections", () => {
  // v2.0.0-rc.23 TASK-013 (F8b): the `sections` z.enum input parameter was
  // removed alongside the A-set heading discipline. The tool now accepts only
  // selection_token + ai_selected_stable_ids + ai_selection_reasons; the body
  // is returned in full keyed by stable_id.
  it("validates selection token, AI-selected stable ids, and selection reasons", () => {
    const registerTool = vi.fn();

    registerKnowledgeSections({
      registerTool,
    } as unknown as McpServer);

    const definition = registerTool.mock.calls[0]?.[1] as {
      inputSchema: z.ZodObject<{
        selection_token: z.ZodString;
        ai_selected_stable_ids: z.ZodArray<z.ZodString>;
        ai_selection_reasons: z.ZodRecord<z.ZodString>;
      }>;
    };

    const shape = definition.inputSchema.shape;

    expect(shape.selection_token.safeParse("selection:rev:abc").success).toBe(true);
    expect(shape.ai_selected_stable_ids.safeParse(["ui-batch-rendering"]).success).toBe(true);
    expect(shape.ai_selection_reasons.safeParse({
      "ui-batch-rendering": "Selected because target touches UI rendering.",
    }).success).toBe(true);
    // Retired `sections` enum field must no longer exist on the schema.
    expect((shape as Record<string, unknown>).sections).toBeUndefined();
  });

  it("registers fab_get_knowledge_sections", () => {
    const registerTool = vi.fn();

    registerKnowledgeSections({
      registerTool,
    } as unknown as McpServer);

    expect(registerTool.mock.calls[0]?.[0]).toBe("fab_get_knowledge_sections");
  });
});
