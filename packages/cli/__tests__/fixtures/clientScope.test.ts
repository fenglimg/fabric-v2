import { describe, expect, it } from "vitest";

import type { ClientKind } from "../../src/config/writer.js";

// Compile-time guard: if someone adds 'Windsurf' back to the ClientKind union,
// this assignment will produce a TypeScript error.
// @ts-expect-error -- 'Windsurf' must not be assignable to ClientKind
const _windsurfCheck: ClientKind = "Windsurf";

// @ts-expect-error -- 'RooCode' must not be assignable to ClientKind
const _rooCodeCheck: ClientKind = "RooCode";

// @ts-expect-error -- 'GeminiCLI' must not be assignable to ClientKind
const _geminiCLICheck: ClientKind = "GeminiCLI";

const allClientKinds: ClientKind[] = ["ClaudeCodeCLI", "ClaudeCodeDesktop", "Cursor", "CodexCLI"];

describe("client scope guard", () => {
  it("has exactly 4 client kinds (2 Claude variants + Cursor + Codex)", () => {
    expect(allClientKinds).toHaveLength(4);
  });

  it("does not include retired clients", () => {
    const sample = allClientKinds as readonly string[];
    for (const retired of ["Windsurf", "RooCode", "GeminiCLI"]) {
      expect(sample).not.toContain(retired);
    }
  });

  it("contains all expected client kinds", () => {
    expect(allClientKinds).toContain("ClaudeCodeCLI");
    expect(allClientKinds).toContain("ClaudeCodeDesktop");
    expect(allClientKinds).toContain("Cursor");
    expect(allClientKinds).toContain("CodexCLI");
  });
});
