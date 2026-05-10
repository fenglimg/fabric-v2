import { describe, expect, it } from "vitest";

import { clientPathsSchema } from "@fenglimg/fabric-shared";
import type { ClientKind } from "../../src/config/writer.js";

// Compile-time guard: if someone adds a retired client back to the ClientKind
// union, these assignments will produce a TypeScript error.
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

  // v2.0 strict-union enforcement: clientPathsSchema must reject any unknown
  // key at Zod parse time (no .passthrough()). This is the runtime
  // counterpart of the compile-time guards above and the regression gate that
  // prevents legacy v1.x keys from silently leaking back into fabric.config.json.
  it("rejects retired client keys at Zod parse time (strict schema, no passthrough)", () => {
    for (const retired of ["windsurf", "rooCode", "geminiCLI"]) {
      expect(() => clientPathsSchema.parse({ [retired]: "/tmp/example" })).toThrow(/[Uu]nrecognized/);
    }
  });

  it("accepts all four supported clientPaths keys", () => {
    expect(() =>
      clientPathsSchema.parse({
        claudeCodeCLI: "/usr/bin/claude",
        claudeCodeDesktop: "/Applications/Claude.app",
        cursor: "/usr/bin/cursor",
        codexCLI: "/usr/bin/codex",
      }),
    ).not.toThrow();
  });
});
