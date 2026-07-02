import { describe, expect, it, vi } from "vitest";

vi.mock("@fenglimg/fabric-shared", () => ({
  redactSecrets: (content: string) =>
    content
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED:email-address]")
      .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[REDACTED:openai-api-key]"),
}));

import { sanitizeHttpKnowledgePayload } from "./response-sanitizer.js";

describe("sanitizeHttpKnowledgePayload", () => {
  it("redacts secret and PII strings without changing non-sensitive fields", () => {
    const payload = {
      id: "ledger:team",
      intent: "call me at user@example.com with api_key=sk-abcdefghijklmnopqrstuvwxyz",
      affected_paths: ["src/team.ts"],
    };

    expect(sanitizeHttpKnowledgePayload(payload)).toEqual({
      id: "ledger:team",
      intent: "call me at [REDACTED:email-address] with api_key=[REDACTED:openai-api-key]",
      affected_paths: ["src/team.ts"],
    });
  });

  it("filters personal ledger entries by KP stable id, personal layer, and personal paths", () => {
    const payload = [
      {
        id: "ledger:team",
        intent: "team edit",
        affected_paths: ["src/team.ts"],
      },
      {
        id: "ledger:personal-id",
        intent: "edited KP-DEC-0001",
        affected_paths: ["src/personal.ts"],
      },
      {
        id: "ledger:personal-layer",
        layer: "personal",
        affected_paths: ["src/team.ts"],
      },
      {
        id: "ledger:personal-path",
        intent: "path leak",
        affected_paths: [".fabric/stores/my-personal-store/knowledge/decisions/foo.md"],
      },
    ];

    expect(sanitizeHttpKnowledgePayload(payload)).toEqual([
      {
        id: "ledger:team",
        intent: "team edit",
        affected_paths: ["src/team.ts"],
      },
    ]);
  });

  it("filters personal history nodes and entries while preserving the public snapshot", () => {
    const payload = {
      meta: {
        revision: "rev",
        nodes: {
          "src/team.ts": {
            file: "src/team.ts",
            scope_glob: "src/team.ts",
            level: "L2",
          },
          "KP-GLD-0001--personal.md": {
            file: "KP-GLD-0001--personal.md",
          },
        },
      },
      metadata: {
        at_ledger_id: "ledger:team",
        mode: "ledger-fallback",
      },
      entries: [
        {
          id: "ledger:team",
          intent: "team edit",
          affected_paths: ["src/team.ts"],
        },
        {
          id: "ledger:personal",
          intent: "personal edit",
          affected_paths: ["KP-DEC-0001--secret.md"],
        },
      ],
    };

    expect(sanitizeHttpKnowledgePayload(payload)).toEqual({
      meta: {
        revision: "rev",
        nodes: {
          "src/team.ts": {
            file: "src/team.ts",
            scope_glob: "src/team.ts",
            level: "L2",
          },
        },
      },
      metadata: {
        at_ledger_id: "ledger:team",
        mode: "ledger-fallback",
      },
      entries: [
        {
          id: "ledger:team",
          intent: "team edit",
          affected_paths: ["src/team.ts"],
        },
      ],
    });
  });
});
