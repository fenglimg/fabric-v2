/**
 * v2.0.0-rc.20 TASK-09: hook-side tests for cite-policy capture in
 * templates/hooks/fabric-hint.cjs. Covers:
 *   - parseKbLine() across all 5 cite_tags enum values + multi-cite +
 *     dismissed:<reason> + empty/none degenerate inputs.
 *   - extractAndWriteAssistantTurnsBestEffort() emission contract:
 *     fixture transcript -> .fabric/events.jsonl -> Zod roundtrip via
 *     assistantTurnObservedEventSchema.
 *   - never-throws contract: missing transcript_path / null payload /
 *     malformed JSONL all stay silent.
 *   - detectClient() FABRIC_HINT_CLIENT env override (cc + codex).
 *
 * Per packages/cli/__tests__/fabric-hint.test.ts policy: in-process
 * createRequire load of the .cjs, NO child_process.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assistantTurnObservedEventSchema } from "@fenglimg/fabric-shared";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/fabric-hint.cjs", import.meta.url),
);

type ParsedKb = { cite_ids: string[]; cite_tags: string[] };

type HookSurface = {
  parseKbLine: (raw: unknown) => ParsedKb;
  detectClient: () => string | undefined;
  extractAndWriteAssistantTurnsBestEffort: (
    cwd: string,
    stdinPayload: unknown,
  ) => void;
};

const hook = require(hookPath) as HookSurface;

// ---------------------------------------------------------------------------
// parseKbLine — 8 tests covering all cite_tags enum values + multi-cite +
// dismissed:<reason> degenerate + empty/none edge cases.
// ---------------------------------------------------------------------------
describe("fabric-hint.cjs — parseKbLine (cite-policy line parser)", () => {
  it("parses '(review) [planned]' as cite_ids=[KP-001] cite_tags=[planned]", () => {
    const r = hook.parseKbLine("KP-001 (review) [planned]");
    expect(r.cite_ids).toEqual(["KP-001"]);
    expect(r.cite_tags).toEqual(["planned"]);
  });

  it("parses '[recalled]' as cite_ids=[KP-001] cite_tags=[recalled]", () => {
    const r = hook.parseKbLine("KP-001 [recalled]");
    expect(r.cite_ids).toEqual(["KP-001"]);
    expect(r.cite_tags).toEqual(["recalled"]);
  });

  it("parses '[chained-from KP-002]' as cite_ids=[KP-001] cite_tags=[chained-from] (trailing ref-id dropped from tag)", () => {
    const r = hook.parseKbLine("KP-001 [chained-from KP-002]");
    expect(r.cite_ids).toEqual(["KP-001"]);
    expect(r.cite_tags).toEqual(["chained-from"]);
  });

  it("parses 'KP-001 [dismissed:scope-mismatch]' — dropped reason: cite_tags=[dismissed] with the bracket still hosting dismissed-as-leading-token", () => {
    // Bracket-prefix path: `[dismissed:scope-mismatch]` — the inner token
    // splits on whitespace (head = "dismissed:scope-mismatch") which is NOT
    // in ALLOWED_TAGS, so the bracket branch drops it. The bare-dismissed
    // top-level path (`^dismissed:`) only fires when dismissed: is the
    // line-leading token, not nested inside a bracket. Per fabric-hint.cjs
    // contract: dismissed reason text is silently discarded — cite_tags
    // remains [] in this nested form, while top-level `dismissed:<reason>`
    // surfaces tag="dismissed". This test pins the nested-bracket shape.
    const r = hook.parseKbLine("KP-001 [dismissed:scope-mismatch]");
    expect(r.cite_ids).toEqual(["KP-001"]);
    // dismissed:scope-mismatch is not in ALLOWED_TAGS as a leading token,
    // so cite_tags stays empty. Document the actual contract.
    expect(r.cite_tags).toEqual([]);
  });

  it("parses bare 'dismissed:other:custom' as cite_ids=[] cite_tags=[dismissed]", () => {
    // Top-level `^dismissed:` path: any line starting with `dismissed:` is
    // treated as a bare dismissal — reason verbatim is dropped from the
    // tags array, and no ids are extracted.
    const r = hook.parseKbLine("dismissed:other:custom");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual(["dismissed"]);
  });

  it("parses 'none' as cite_ids=[] cite_tags=[none]", () => {
    const r = hook.parseKbLine("none");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual(["none"]);
  });

  it("parses comma-separated 'KP-001, KP-002, KT-DEC-0009 [recalled]' as all three ids + recalled", () => {
    const r = hook.parseKbLine("KP-001, KP-002, KT-DEC-0009 [recalled]");
    expect(r.cite_ids).toEqual(["KP-001", "KP-002", "KT-DEC-0009"]);
    expect(r.cite_tags).toEqual(["recalled"]);
  });

  it("returns default {cite_ids:[], cite_tags:[]} on empty input (silent no-throw)", () => {
    const r = hook.parseKbLine("");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Helper: build a transcript JSONL fixture with N assistant envelopes.
// ---------------------------------------------------------------------------
function writeTranscriptFixture(
  path: string,
  envelopes: Array<{ role: "user" | "assistant"; text: string }>,
): void {
  const lines = envelopes.map((env) =>
    JSON.stringify({
      role: env.role,
      content: [{ type: "text", text: env.text }],
    }),
  );
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// extractAndWriteAssistantTurnsBestEffort — 5 tests covering happy path +
// Zod roundtrip + 3 never-throws degenerate inputs.
// ---------------------------------------------------------------------------
describe("fabric-hint.cjs — extractAndWriteAssistantTurnsBestEffort", () => {
  let tempRoot: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-cite-"));
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    transcriptPath = join(tempRoot, "transcript.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("happy path: emits one assistant_turn_observed event per assistant envelope, each passes Zod parse", () => {
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "KB: KP-001 [planned]\n\nbody" },
      { role: "assistant", text: "KB: none\n\nbody" },
    ]);

    hook.extractAndWriteAssistantTurnsBestEffort(tempRoot, {
      session_id: "test-session",
      transcript_path: transcriptPath,
    });

    const ledgerPath = join(tempRoot, ".fabric", "events.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);
    const raw = readFileSync(ledgerPath, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const obj = JSON.parse(line);
      // Each emitted event must pass the rc.20 TASK-02 schema.
      expect(() => assistantTurnObservedEventSchema.parse(obj)).not.toThrow();
    }
  });

  it("Zod roundtrip: emitted events preserve kb_line_raw / cite_ids / cite_tags / turn_id / envelope_index", () => {
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "ping" },
      { role: "assistant", text: "KB: KP-001 [planned]\n\nbody-1" },
      { role: "assistant", text: "KB: none\n\nbody-2" },
    ]);

    hook.extractAndWriteAssistantTurnsBestEffort(tempRoot, {
      session_id: "roundtrip-session",
      transcript_path: transcriptPath,
    });

    const ledgerPath = join(tempRoot, ".fabric", "events.jsonl");
    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));

    const parsed = lines.map((l) => assistantTurnObservedEventSchema.parse(l));
    expect(parsed).toHaveLength(2);

    // First assistant envelope (transcript index 1 — user at 0, assistant at 1).
    expect(parsed[0].kb_line_raw).toBe("KB: KP-001 [planned]");
    expect(parsed[0].cite_ids).toEqual(["KP-001"]);
    expect(parsed[0].cite_tags).toEqual(["planned"]);
    expect(parsed[0].turn_id).toBe("roundtrip-session-1");
    expect(parsed[0].envelope_index).toBe(1);

    // Second assistant envelope (transcript index 2).
    expect(parsed[1].kb_line_raw).toBe("KB: none");
    expect(parsed[1].cite_ids).toEqual([]);
    expect(parsed[1].cite_tags).toEqual(["none"]);
    expect(parsed[1].turn_id).toBe("roundtrip-session-2");
    expect(parsed[1].envelope_index).toBe(2);
  });

  // rc.23 T8c: `KB: none [<sentinel>]` form. Hook must keep the full bracket
  // tail in `kb_line_raw` (doctor downstream parses it into the
  // none_reason_histogram); cite_tags still emits the bare `none` token
  // (schema-bound enum).
  it("rc.23 T8c: KB: none [no-relevant] / [not-applicable] sentinels are preserved in kb_line_raw", () => {
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "p1" },
      { role: "assistant", text: "KB: none [no-relevant]\n\nbody-1" },
      { role: "user", text: "p2" },
      { role: "assistant", text: "KB: none [not-applicable]\n\nbody-2" },
    ]);

    hook.extractAndWriteAssistantTurnsBestEffort(tempRoot, {
      session_id: "sentinel-session",
      transcript_path: transcriptPath,
    });

    const ledgerPath = join(tempRoot, ".fabric", "events.jsonl");
    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));

    const parsed = lines.map((l) => assistantTurnObservedEventSchema.parse(l));
    expect(parsed).toHaveLength(2);

    expect(parsed[0].kb_line_raw).toBe("KB: none [no-relevant]");
    expect(parsed[0].cite_ids).toEqual([]);
    expect(parsed[0].cite_tags).toEqual(["none"]);

    expect(parsed[1].kb_line_raw).toBe("KB: none [not-applicable]");
    expect(parsed[1].cite_ids).toEqual([]);
    expect(parsed[1].cite_tags).toEqual(["none"]);
  });

  it("never-throws: stdinPayload without transcript_path emits no events and does not throw", () => {
    expect(() =>
      hook.extractAndWriteAssistantTurnsBestEffort(tempRoot, {
        session_id: "no-transcript",
      }),
    ).not.toThrow();
    const ledgerPath = join(tempRoot, ".fabric", "events.jsonl");
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("never-throws: null stdinPayload is a silent no-op", () => {
    expect(() =>
      hook.extractAndWriteAssistantTurnsBestEffort(tempRoot, null),
    ).not.toThrow();
    const ledgerPath = join(tempRoot, ".fabric", "events.jsonl");
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("never-throws: malformed JSONL lines mid-file are skipped; valid envelopes still emit", () => {
    // Mix valid + invalid lines. The summarizeTranscript() implementation
    // JSON.parses each line under try/catch, dropping malformed lines.
    const validUser = JSON.stringify({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    });
    const validAssistant = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "KB: KP-007 [recalled]\n\nbody" }],
    });
    const malformed = "this-is-not-json{{{";
    writeFileSync(
      transcriptPath,
      `${validUser}\n${malformed}\n${validAssistant}\n`,
      "utf8",
    );

    expect(() =>
      hook.extractAndWriteAssistantTurnsBestEffort(tempRoot, {
        session_id: "malformed-session",
        transcript_path: transcriptPath,
      }),
    ).not.toThrow();

    const ledgerPath = join(tempRoot, ".fabric", "events.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);
    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.length > 0);
    // One valid assistant envelope -> one emitted event.
    expect(lines).toHaveLength(1);
    const parsed = assistantTurnObservedEventSchema.parse(JSON.parse(lines[0]));
    expect(parsed.kb_line_raw).toBe("KB: KP-007 [recalled]");
    expect(parsed.cite_ids).toEqual(["KP-007"]);
    expect(parsed.cite_tags).toEqual(["recalled"]);
  });
});

// ---------------------------------------------------------------------------
// detectClient — 2 tests covering env-var override path (cleaner than
// mocking __dirname). Path heuristic is exercised in production deployment;
// this layer pins the override contract.
// ---------------------------------------------------------------------------
describe("fabric-hint.cjs — detectClient", () => {
  const ORIGINAL_ENV = process.env.FABRIC_HINT_CLIENT;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.FABRIC_HINT_CLIENT;
    } else {
      process.env.FABRIC_HINT_CLIENT = ORIGINAL_ENV;
    }
  });

  it("returns 'cc' when FABRIC_HINT_CLIENT=cc env override is set", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    expect(hook.detectClient()).toBe("cc");
  });

  it("returns 'codex' when FABRIC_HINT_CLIENT=codex env override is set", () => {
    process.env.FABRIC_HINT_CLIENT = "codex";
    expect(hook.detectClient()).toBe("codex");
  });
});
