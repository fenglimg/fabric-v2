import { describe, expect, it } from "vitest";

import { runTreeSitterProbe } from "../src/scanner/tree-sitter-probe.ts";

describe("web-tree-sitter WASM probe", () => {
  it("loads the runtime and JavaScript grammar WASM in the CLI Node context", async () => {
    const result = await runTreeSitterProbe();

    expect(result.ok).toBe(true);
    expect(result.root_node_type).toBe("program");
    expect(result.has_error).toBe(false);
    expect(result.elapsed_ms).toBeLessThan(2_000);
    expect(result.wasm.runtime_bytes).toBeGreaterThan(0);
    expect(result.wasm.javascript_grammar_bytes).toBeGreaterThan(0);
    expect(result.decision.loading_strategy).toBe("lazy");
    expect(result.decision.status).toBe("feasible");
  });

  it("reports JavaScript grammar limitations for TypeScript-only syntax", async () => {
    const result = await runTreeSitterProbe("type User = { id: string };\nexport const user: User = { id: \"1\" };\n");

    expect(result.ok).toBe(false);
    expect(result.has_error).toBe(true);
    expect(result.decision.grammar_strategy).toContain("tree-sitter-typescript");
  });
});
