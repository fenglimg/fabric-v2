import { describe, expect, it } from "vitest";

import { parseClientFilter } from "../src/commands/config.ts";

describe("config install client aliases", () => {
  it("resolves claude to ClaudeCodeCLI", () => {
    expect(parseClientFilter("claude")).toEqual(new Set(["ClaudeCodeCLI"]));
  });

  it("keeps existing cursor, codex, and gemini aliases working", () => {
    expect(parseClientFilter("cursor,codex,gemini")).toEqual(new Set(["Cursor", "CodexCLI", "GeminiCLI"]));
  });
});
