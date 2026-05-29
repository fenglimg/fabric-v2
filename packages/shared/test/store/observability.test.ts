import { describe, expect, it } from "vitest";

import { buildDebugBundle, buildFailureTrace } from "../../src/store/observability.js";

// v2.1.0-rc.1 P6 (S40) — structured failure trace + redacted debug bundle.

const AWS_KEY = "AKIA1234567890ABCDEF";
const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwxyz0123456789";

describe("buildFailureTrace — every failure path has a structured trace", () => {
  it("derives a structured trace from an Error with explicit code + context", () => {
    const trace = buildFailureTrace(
      "sync",
      new Error("rebase failed in store team"),
      { store: "team", remote: "git@h:team.git" },
      "rebase_conflict",
    );
    expect(trace.stage).toBe("sync");
    expect(trace.code).toBe("rebase_conflict");
    expect(trace.message).toContain("rebase failed");
    expect(trace.context.store).toBe("team");
  });

  it("falls back to the error name when no code is supplied", () => {
    const err = new TypeError("bad input");
    const trace = buildFailureTrace("mcp", err);
    expect(trace.code).toBe("TypeError");
    expect(trace.stage).toBe("mcp");
  });

  it("redacts a secret that leaked into an error message or context", () => {
    const trace = buildFailureTrace(
      "install",
      new Error(`clone failed using token ${OPENAI_KEY}`),
      { remote: `https://${AWS_KEY}@host/repo.git` },
    );
    expect(trace.message).not.toContain(OPENAI_KEY);
    expect(trace.message).toContain("[REDACTED:");
    expect(String(trace.context.remote)).not.toContain(AWS_KEY);
  });
});

describe("buildDebugBundle — redaction negative test (no plaintext secrets)", () => {
  it("redacts secrets across config, diagnostics, and events; never echoes plaintext", () => {
    const bundle = buildDebugBundle({
      config: { remote: `https://${AWS_KEY}@h/r.git`, nested: { key: OPENAI_KEY } },
      diagnostics: [{ message: `found ${OPENAI_KEY} in entry` }],
      events: [`{"raw":"token=${AWS_KEY}"}`],
      includeEvents: true,
    });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(AWS_KEY);
    expect(serialized).not.toContain(OPENAI_KEY);
    expect(serialized).toContain("[REDACTED:");
    expect(bundle.redacted).toBe(true);
  });

  it("excludes events by default (events may carry user prose / paths)", () => {
    const bundle = buildDebugBundle({
      config: {},
      diagnostics: [],
      events: ["some-event-line"],
    });
    expect(bundle.events).toEqual([]);
  });

  it("clean input passes through untouched (no spurious redaction)", () => {
    const bundle = buildDebugBundle({
      config: { language: "en", store_count: 3 },
      diagnostics: [{ code: "local_only_store", ref: "team" }],
    });
    expect(bundle.config.language).toBe("en");
    expect(bundle.config.store_count).toBe(3);
    expect(JSON.stringify(bundle)).not.toContain("[REDACTED:");
  });
});
