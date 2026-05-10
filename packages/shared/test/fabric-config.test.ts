import { describe, expect, it } from "vitest";

import {
  defaultLayerFilterSchema,
  fabricConfigSchema,
  knowledgeLanguageSchema,
} from "../src/schemas/fabric-config";

// ---------------------------------------------------------------------------
// fabric-config schema — knowledge_language + default_layer_filter
//
// v2.0 grill-followup TASK-002: two new optional fields drive Q3 (language
// policy) and Q6 (layer-filter default). Both are `.optional().default(...)`
// so existing fabric-config.json files parse unchanged (backward-compat).
// ---------------------------------------------------------------------------

describe("fabricConfigSchema — knowledge_language", () => {
  it("accepts all three knowledge_language enum values", () => {
    for (const value of ["match-existing", "zh-CN", "en"] as const) {
      const parsed = fabricConfigSchema.parse({ knowledge_language: value });
      expect(parsed.knowledge_language).toBe(value);
    }
  });

  it("rejects an invalid knowledge_language enum value", () => {
    expect(() =>
      fabricConfigSchema.parse({ knowledge_language: "japanese" }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ knowledge_language: "" }),
    ).toThrow();
  });

  it("standalone knowledgeLanguageSchema mirrors the enum domain", () => {
    expect(knowledgeLanguageSchema.parse("match-existing")).toBe(
      "match-existing",
    );
    expect(() => knowledgeLanguageSchema.parse("ja-JP")).toThrow();
  });
});

describe("fabricConfigSchema — default_layer_filter", () => {
  it("accepts all three default_layer_filter enum values", () => {
    for (const value of ["team", "personal", "both"] as const) {
      const parsed = fabricConfigSchema.parse({ default_layer_filter: value });
      expect(parsed.default_layer_filter).toBe(value);
    }
  });

  it("rejects an invalid default_layer_filter enum value", () => {
    expect(() =>
      fabricConfigSchema.parse({ default_layer_filter: "global" }),
    ).toThrow();
    expect(() =>
      fabricConfigSchema.parse({ default_layer_filter: "BOTH" }),
    ).toThrow();
  });

  it("standalone defaultLayerFilterSchema mirrors the enum domain", () => {
    expect(defaultLayerFilterSchema.parse("both")).toBe("both");
    expect(() => defaultLayerFilterSchema.parse("all")).toThrow();
  });
});

describe("fabricConfigSchema — defaults and backward compatibility", () => {
  it("missing fields apply defaults: match-existing / both", () => {
    const parsed = fabricConfigSchema.parse({});
    expect(parsed.knowledge_language).toBe("match-existing");
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("partial config (only knowledge_language) defaults default_layer_filter", () => {
    const parsed = fabricConfigSchema.parse({ knowledge_language: "zh-CN" });
    expect(parsed.knowledge_language).toBe("zh-CN");
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("partial config (only default_layer_filter) defaults knowledge_language", () => {
    const parsed = fabricConfigSchema.parse({ default_layer_filter: "team" });
    expect(parsed.knowledge_language).toBe("match-existing");
    expect(parsed.default_layer_filter).toBe("team");
  });

  it("previous-version fixture still parses (regression: no new fields supplied)", () => {
    // Snapshot of a v2.0-rc.1-shaped fabric-config.json — none of the
    // grill-followup fields are present. Must parse cleanly with defaults.
    const previousVersionFixture = {
      clientPaths: {
        claudeCodeCLI: "/usr/local/bin/claude",
        cursor: "/Applications/Cursor.app/Contents/MacOS/Cursor",
      },
      externalFixturePath: "/tmp/fixtures",
      scanIgnores: ["node_modules", "dist", ".git"],
      auditMode: "strict" as const,
      mcpPayloadLimits: { warnBytes: 8192, hardBytes: 32768 },
    };
    const parsed = fabricConfigSchema.parse(previousVersionFixture);

    // Existing fields preserved verbatim.
    expect(parsed.clientPaths).toEqual(previousVersionFixture.clientPaths);
    expect(parsed.externalFixturePath).toBe("/tmp/fixtures");
    expect(parsed.scanIgnores).toEqual(["node_modules", "dist", ".git"]);
    expect(parsed.auditMode).toBe("strict");
    expect(parsed.mcpPayloadLimits).toEqual({
      warnBytes: 8192,
      hardBytes: 32768,
    });

    // New fields filled by defaults.
    expect(parsed.knowledge_language).toBe("match-existing");
    expect(parsed.default_layer_filter).toBe("both");
  });

  it("explicit values override defaults across full config", () => {
    const parsed = fabricConfigSchema.parse({
      clientPaths: { claudeCodeCLI: "/usr/bin/claude" },
      knowledge_language: "en",
      default_layer_filter: "personal",
    });
    expect(parsed.knowledge_language).toBe("en");
    expect(parsed.default_layer_filter).toBe("personal");
    expect(parsed.clientPaths).toEqual({ claudeCodeCLI: "/usr/bin/claude" });
  });
});
