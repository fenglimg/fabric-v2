/**
 * v2.0.0-rc.20 TASK-09 → v2.0.0-rc.24 TASK-04: hook-side tests for cite-policy
 * capture in templates/hooks/fabric-hint.cjs.
 *
 * Covers:
 *   - parseKbLine() legacy shim — post-rc.24 it delegates to the shared
 *     parseCiteLine (lib/cite-line-parser.cjs CJS twin), strict id form
 *     K[TP]-[A-Z]+-\d+, returns the new `cite_commitments` parallel field.
 *   - extractAndWriteAssistantTurnsBestEffort() emission contract:
 *     fixture transcript → .fabric/events.jsonl → Zod roundtrip via
 *     assistantTurnObservedEventSchema. Events now carry `cite_commitments`.
 *   - rc.24 contract-syntax variants (≥5 new cases): edit / !edit / require /
 *     forbid / skip:<reason> operator vocabulary on the cite line.
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

type CiteCommitment = {
  operators: Array<{ kind: string; target: string }>;
  skip_reason: string | null;
};

type ParsedKb = {
  cite_ids: string[];
  cite_tags: string[];
  cite_commitments: CiteCommitment[];
};

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
// parseKbLine — rc.24 contract: strict id form, cite_commitments parallel
// field, sentinel/full/skip variants all delegate to the shared parser.
// The shim accepts the post-`KB:` substring (callers strip the prefix).
// ---------------------------------------------------------------------------
describe("fabric-hint.cjs — parseKbLine (rc.24 shim delegating to shared parseCiteLine)", () => {
  it("parses '(review) [planned]' on strict id form: cite_ids=[KT-DEC-0001], cite_tags=[planned], commitment with no operators", () => {
    const r = hook.parseKbLine("KT-DEC-0001 (review) [planned]");
    expect(r.cite_ids).toEqual(["KT-DEC-0001"]);
    expect(r.cite_tags).toEqual(["planned"]);
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: null },
    ]);
  });

  it("parses '[recalled]' as cite_ids=[KP-PAT-0042] cite_tags=[recalled] with empty operators/null skip", () => {
    const r = hook.parseKbLine("KP-PAT-0042 [recalled]");
    expect(r.cite_ids).toEqual(["KP-PAT-0042"]);
    expect(r.cite_tags).toEqual(["recalled"]);
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: null },
    ]);
  });

  it("parses '[chained-from KT-DEC-0009]' — bracket tail head normalized to 'chained-from', embedded id surfaced (rc.27)", () => {
    const r = hook.parseKbLine("KT-DEC-0001 (anchor) [chained-from KT-DEC-0009]");
    // v2.0.0-rc.27 TASK-003 (audit §2.18): the chained-from tail's embedded
    // id now lands in cite_ids as a sibling reference so cite-coverage
    // routing can resolve the chain. Prior rc.26 behavior dropped it
    // silently — the tag was recognised but the linked id never reached
    // downstream consumers.
    expect(r.cite_ids).toEqual(["KT-DEC-0001", "KT-DEC-0009"]);
    expect(r.cite_tags).toEqual(["chained-from"]);
    // No `→` tail → empty commitment. v2.0.0-rc.27.1 (Codex review fix):
    // commitment array is index-aligned with cite_ids, so the shared empty
    // commitment appears once per id slot.
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: null },
      { operators: [], skip_reason: null },
    ]);
  });

  it("parses '[dismissed:scope-mismatch]' — bracket head 'dismissed' (reason text dropped from cite_tags)", () => {
    const r = hook.parseKbLine("KT-DEC-0001 (a) [dismissed:scope-mismatch]");
    expect(r.cite_ids).toEqual(["KT-DEC-0001"]);
    expect(r.cite_tags).toEqual(["dismissed"]);
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: null },
    ]);
  });

  it("parses sentinel 'none' (post-`KB:` shim composes back to `KB: none`)", () => {
    const r = hook.parseKbLine("none");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual(["none"]);
    expect(r.cite_commitments).toEqual([]);
  });

  it("parses sentinel 'none [no-relevant]' (sentinel-with-reason form)", () => {
    const r = hook.parseKbLine("none [no-relevant]");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual(["none"]);
    expect(r.cite_commitments).toEqual([]);
  });

  it("returns default {cite_ids:[], cite_tags:[], cite_commitments:[]} on empty input (silent no-throw)", () => {
    const r = hook.parseKbLine("");
    expect(r.cite_ids).toEqual([]);
    expect(r.cite_tags).toEqual([]);
    expect(r.cite_commitments).toEqual([]);
  });

  // -----------------------------------------------------------------
  // rc.24 TASK-04: ≥5 new contract-syntax cases mirroring TASK-03 corpus.
  // -----------------------------------------------------------------
  it("rc.24 contract: single edit operator → cite_commitments=[{operators:[{kind:edit,target:.fabric/AGENTS.md}], skip_reason:null}]", () => {
    const r = hook.parseKbLine(
      "KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md",
    );
    expect(r.cite_ids).toEqual(["KT-DEC-9003"]);
    expect(r.cite_tags).toEqual(["recalled"]);
    expect(r.cite_commitments).toEqual([
      {
        operators: [{ kind: "edit", target: ".fabric/AGENTS.md" }],
        skip_reason: null,
      },
    ]);
  });

  it("rc.24 contract: !edit operator maps to kind=not_edit (source-token to schema-kind translation)", () => {
    const r = hook.parseKbLine(
      "KT-DEC-9003 (Summary) [recalled] → !edit:CLAUDE.md",
    );
    expect(r.cite_commitments).toEqual([
      {
        operators: [{ kind: "not_edit", target: "CLAUDE.md" }],
        skip_reason: null,
      },
    ]);
  });

  it("rc.24 contract: all four operator kinds in one cite line", () => {
    const r = hook.parseKbLine(
      "KT-DEC-9003 (anchor) [planned] → edit:foo.ts !edit:bar.ts require:trimEnd forbid:JSON.parse",
    );
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "foo.ts" },
      { kind: "not_edit", target: "bar.ts" },
      { kind: "require", target: "trimEnd" },
      { kind: "forbid", target: "JSON.parse" },
    ]);
    expect(r.cite_commitments[0].skip_reason).toBeNull();
  });

  it("rc.24 contract: skip:<reason> populates skip_reason (operators empty)", () => {
    const r = hook.parseKbLine(
      "KT-DEC-9003 (Summary) [recalled] → skip:sequencing",
    );
    expect(r.cite_commitments).toEqual([
      { operators: [], skip_reason: "sequencing" },
    ]);
  });

  it("rc.24 contract: skip:other:<text> preserves colon-bearing reason verbatim", () => {
    const r = hook.parseKbLine(
      "KT-DEC-9003 (Summary) [recalled] → skip:other:non-codifiable",
    );
    expect(r.cite_commitments[0].skip_reason).toBe("other:non-codifiable");
    expect(r.cite_commitments[0].operators).toEqual([]);
  });

  it("rc.24 contract: glob target preserved verbatim (e.g. src/auth/**/*.ts)", () => {
    const r = hook.parseKbLine(
      "KT-DEC-0001 (a) [planned] → edit:src/auth/**/*.ts",
    );
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "src/auth/**/*.ts" },
    ]);
  });

  it("rc.24 contract: unknown operator tokens silently dropped (forward-compat for rc.25+ vocab)", () => {
    const r = hook.parseKbLine(
      "KT-DEC-9003 (a) [recalled] → edit:foo.ts call:unknownFn sequence:later",
    );
    // Only edit:foo.ts is retained.
    expect(r.cite_commitments[0].operators).toEqual([
      { kind: "edit", target: "foo.ts" },
    ]);
    expect(r.cite_commitments[0].skip_reason).toBeNull();
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
// extractAndWriteAssistantTurnsBestEffort — emission contract incl. rc.24
// cite_commitments field, Zod roundtrip + 3 never-throws degenerate inputs.
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

  it("happy path: emits one assistant_turn_observed event per assistant envelope, each passes Zod parse incl. cite_commitments", () => {
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "hello" },
      { role: "assistant", text: "KB: KT-DEC-0001 [planned]\n\nbody" },
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
      // Each emitted event must pass the rc.24 schema (cite_commitments slot).
      expect(() => assistantTurnObservedEventSchema.parse(obj)).not.toThrow();
      // rc.24 TASK-04: cite_commitments is now always present in emitted shape.
      expect(Object.prototype.hasOwnProperty.call(obj, "cite_commitments")).toBe(true);
      expect(Array.isArray(obj.cite_commitments)).toBe(true);
    }
  });

  it("Zod roundtrip: cite_commitments correctly populated from contract syntax on the assistant cite line", () => {
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "ping" },
      {
        role: "assistant",
        text:
          "KB: KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md !edit:CLAUDE.md\n\nbody-1",
      },
      {
        role: "assistant",
        text: "KB: KT-DEC-9001 (a) [recalled] → skip:sequencing\n\nbody-2",
      },
      { role: "assistant", text: "KB: none [no-relevant]\n\nbody-3" },
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
    expect(parsed).toHaveLength(3);

    // First cite — edit + !edit operators.
    expect(parsed[0].kb_line_raw).toBe(
      "KB: KT-DEC-9003 (Summary) [recalled] → edit:.fabric/AGENTS.md !edit:CLAUDE.md",
    );
    expect(parsed[0].cite_ids).toEqual(["KT-DEC-9003"]);
    expect(parsed[0].cite_tags).toEqual(["recalled"]);
    expect(parsed[0].cite_commitments).toEqual([
      {
        operators: [
          { kind: "edit", target: ".fabric/AGENTS.md" },
          { kind: "not_edit", target: "CLAUDE.md" },
        ],
        skip_reason: null,
      },
    ]);

    // Second cite — skip:sequencing.
    expect(parsed[1].cite_ids).toEqual(["KT-DEC-9001"]);
    expect(parsed[1].cite_commitments).toEqual([
      { operators: [], skip_reason: "sequencing" },
    ]);

    // Sentinel — no commitments emitted (index contract).
    expect(parsed[2].kb_line_raw).toBe("KB: none [no-relevant]");
    expect(parsed[2].cite_ids).toEqual([]);
    expect(parsed[2].cite_tags).toEqual(["none"]);
    expect(parsed[2].cite_commitments).toEqual([]);
  });

  // rc.23 T8c: `KB: none [<sentinel>]` form. Hook keeps full bracket tail in
  // `kb_line_raw`; cite_tags emits the bare `none` token; cite_commitments
  // stays empty (sentinel index contract).
  it("rc.23 T8c → rc.24: KB: none [no-relevant] / [not-applicable] sentinels preserved in kb_line_raw, cite_commitments=[]", () => {
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
    expect(parsed[0].cite_commitments).toEqual([]);

    expect(parsed[1].kb_line_raw).toBe("KB: none [not-applicable]");
    expect(parsed[1].cite_ids).toEqual([]);
    expect(parsed[1].cite_tags).toEqual(["none"]);
    expect(parsed[1].cite_commitments).toEqual([]);
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

  it("never-throws: malformed JSONL lines mid-file are skipped; valid envelopes still emit incl. cite_commitments", () => {
    const validUser = JSON.stringify({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    });
    const validAssistant = JSON.stringify({
      role: "assistant",
      content: [
        { type: "text", text: "KB: KT-DEC-0007 [recalled] → require:trimEnd\n\nbody" },
      ],
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
    expect(lines).toHaveLength(1);
    const parsed = assistantTurnObservedEventSchema.parse(JSON.parse(lines[0]));
    expect(parsed.kb_line_raw).toBe(
      "KB: KT-DEC-0007 [recalled] → require:trimEnd",
    );
    expect(parsed.cite_ids).toEqual(["KT-DEC-0007"]);
    expect(parsed.cite_tags).toEqual(["recalled"]);
    expect(parsed.cite_commitments).toEqual([
      { operators: [{ kind: "require", target: "trimEnd" }], skip_reason: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// detectClient — 2 tests covering env-var override path.
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
