/**
 * v2.0.0-rc.24 TASK-05: hook-side tests for the L1 soft reminder layer in
 * `packages/cli/templates/hooks/fabric-hint.cjs` +
 * `packages/cli/templates/hooks/lib/cite-contract-reminder.cjs`.
 *
 * Reminder contract (B2 + B6 locks):
 *   - Triggered ONLY when cite_tags contains "recalled" AND
 *     cite_commitments[i].operators is empty AND skip_reason is null AND
 *     idTypeMap.get(cite_ids[i]) ∈ {decision, pitfall}.
 *   - One reminder line per offending id, deduplicated across the turn
 *     summary; sentinel turns contribute no offenders.
 *   - Reminder format:
 *     `⚠ KB: <id> cited as [recalled] but missing contract; add ` +
 *     `\`→ edit:<glob>\` or \`→ skip:<reason>\` next turn`
 *   - Non-blocking — written to stderr, never throws.
 *
 * Per packages/cli/__tests__/fabric-hint.test.ts policy: in-process
 * createRequire load of the .cjs, no child_process; transcript fixtures
 * mirror the Claude Code envelope shape used by fabric-hint-cite.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/fabric-hint.cjs", import.meta.url),
);
const reminderLibPath = fileURLToPath(
  new URL("../templates/hooks/lib/cite-contract-reminder.cjs", import.meta.url),
);

type CiteCommitment = {
  operators: Array<{ kind: string; target: string }>;
  skip_reason: string | null;
};

type AssistantTurn = {
  envelope_index: number;
  kb_line_raw: string | null;
  cite_ids: string[];
  cite_tags: string[];
  cite_commitments: CiteCommitment[];
};

type HookSurface = {
  emitCiteContractRemindersBestEffort: (
    cwd: string,
    stdinPayload: unknown,
    stderr: { write: (chunk: string) => void } | null,
  ) => string[];
};

type ReminderLib = {
  readKnowledgeTypeMap: (projectRoot: string) => Map<string, string>;
  formatContractMissingReminders: (args: {
    assistant_turns: AssistantTurn[];
    idTypeMap: Map<string, string>;
  }) => string[];
};

const hook = require(hookPath) as HookSurface;
const reminderLib = require(reminderLibPath) as ReminderLib;

// ---------------------------------------------------------------------------
// Helpers
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

function writeAgentsMeta(
  tempRoot: string,
  idTypes: Record<string, string>,
): void {
  const nodes: Record<string, unknown> = {};
  for (const [id, kt] of Object.entries(idTypes)) {
    nodes[id] = {
      file: `.fabric/knowledge/${kt}s/${id}.md`,
      scope_glob: `${kt}s/${id}/**`,
      hash: "sha256:test",
      stable_id: id,
      description: {
        summary: `${id} fixture`,
        intent_clues: [],
        tech_stack: [],
        impact: [],
        must_read_if: "",
        id,
        knowledge_type: kt,
      },
    };
  }
  const meta = { revision: "sha256:test", nodes };
  writeFileSync(
    join(tempRoot, ".fabric", "agents.meta.json"),
    JSON.stringify(meta),
    "utf8",
  );
}

class StderrCollector {
  public chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(chunk);
  }
  joined(): string {
    return this.chunks.join("");
  }
  lines(): string[] {
    return this.chunks
      .join("")
      .split("\n")
      .filter((l) => l.length > 0);
  }
}

// ---------------------------------------------------------------------------
// formatContractMissingReminders — pure-function unit tests over the filter.
// ---------------------------------------------------------------------------
describe("cite-contract-reminder.cjs — formatContractMissingReminders", () => {
  const idTypeMap = new Map<string, string>([
    ["KT-DEC-0001", "decision"],
    ["KT-PIT-0001", "pitfall"],
    ["KT-MOD-0001", "model"],
    ["KT-GLD-0001", "guideline"],
    ["KT-PRO-0001", "process"],
    ["KP-DEC-0001", "decision"],
  ]);

  it("(1) decisions cite with operators → NO reminder", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-0001 [recalled] → edit:src/foo.ts",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [
          { operators: [{ kind: "edit", target: "src/foo.ts" }], skip_reason: null },
        ],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(2) decisions cite without contract → reminder emitted", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-0001 [recalled]",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    const out = reminderLib.formatContractMissingReminders({
      assistant_turns: turns,
      idTypeMap,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("⚠ KB: KT-DEC-0001");
    expect(out[0]).toContain("[recalled]");
    expect(out[0]).toContain("→ edit:");
    expect(out[0]).toContain("→ skip:");
  });

  it("(3) pitfalls cite with skip:sequencing → NO reminder (skip counts as satisfied)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-PIT-0001 [recalled] → skip:sequencing",
        cite_ids: ["KT-PIT-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: "sequencing" }],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(4) models cite without contract → NO reminder (type-routed out)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-MOD-0001 [recalled]",
        cite_ids: ["KT-MOD-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(4b) guidelines/processes cites without contract → NO reminder (type-routed out)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-GLD-0001 [recalled]",
        cite_ids: ["KT-GLD-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
      {
        envelope_index: 1,
        kb_line_raw: "KB: KT-PRO-0001 [recalled]",
        cite_ids: ["KT-PRO-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(5) recalled-but-unresolved id → NO reminder (cannot type-check, defer to doctor)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-9999 [recalled]",
        cite_ids: ["KT-DEC-9999"], // not in idTypeMap
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(6) multiple offenders across turns → multi-line reminder, deduplicated by id", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-0001 [recalled]",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
      {
        envelope_index: 1,
        kb_line_raw: "KB: KT-PIT-0001 [recalled]",
        cite_ids: ["KT-PIT-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
      {
        envelope_index: 2,
        kb_line_raw: "KB: KT-DEC-0001 [recalled]",
        cite_ids: ["KT-DEC-0001"], // duplicate id — must not produce a second line.
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    const out = reminderLib.formatContractMissingReminders({
      assistant_turns: turns,
      idTypeMap,
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("KT-DEC-0001");
    expect(out[1]).toContain("KT-PIT-0001");
  });

  // v2.0.0-rc.27.1 (Codex review fix): multi-id citation reminder walk must
  // look up commitments[i] for EVERY i < cite_ids.length. Before the parser
  // fix, a 2-id cite missing contract only surfaced ONE id in the reminder
  // because commitments[1] === undefined caused the loop to `continue`. This
  // test guards against that regression by feeding the post-fix wire shape
  // (one commitment slot per id) and verifying both ids appear in the
  // reminder output.
  it("(6b) multi-id cite with shared empty commitment → reminder lists every id (rc.27.1)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-0001, KT-PIT-0001 [recalled]",
        cite_ids: ["KT-DEC-0001", "KT-PIT-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [
          { operators: [], skip_reason: null },
          { operators: [], skip_reason: null },
        ],
      },
    ];
    const out = reminderLib.formatContractMissingReminders({
      assistant_turns: turns,
      idTypeMap,
    });
    expect(out).toHaveLength(2);
    expect(out.join("\n")).toContain("KT-DEC-0001");
    expect(out.join("\n")).toContain("KT-PIT-0001");
  });

  // Companion to (6b): a multi-id cite with a SHARED contract operator must
  // NOT emit any reminder for either id — both slots carry the operator.
  it("(6c) multi-id cite with shared operator contract → NO reminder (rc.27.1)", () => {
    const sharedCommitment = {
      operators: [{ kind: "edit" as const, target: "src/foo.ts" }],
      skip_reason: null,
    };
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw:
          "KB: KT-DEC-0001, KT-PIT-0001 [recalled] → edit:src/foo.ts",
        cite_ids: ["KT-DEC-0001", "KT-PIT-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [sharedCommitment, sharedCommitment],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(7) non-recalled tag (planned) → NO reminder even on decisions cite", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-0001 [planned]",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["planned"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(8) sentinel-only turn → NO reminder (cite_ids empty)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: none [no-relevant]",
        cite_ids: [],
        cite_tags: ["none"],
        cite_commitments: [],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({ assistant_turns: turns, idTypeMap }),
    ).toEqual([]);
  });

  it("(9) empty turn array → NO reminder, no throw", () => {
    expect(
      reminderLib.formatContractMissingReminders({
        assistant_turns: [],
        idTypeMap,
      }),
    ).toEqual([]);
  });

  it("(10) empty idTypeMap → NO reminder (no way to type-route)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KT-DEC-0001 [recalled]",
        cite_ids: ["KT-DEC-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    expect(
      reminderLib.formatContractMissingReminders({
        assistant_turns: turns,
        idTypeMap: new Map(),
      }),
    ).toEqual([]);
  });

  it("(11) personal-layer decisions cite without contract → reminder emitted (KP-* parity)", () => {
    const turns: AssistantTurn[] = [
      {
        envelope_index: 0,
        kb_line_raw: "KB: KP-DEC-0001 [recalled]",
        cite_ids: ["KP-DEC-0001"],
        cite_tags: ["recalled"],
        cite_commitments: [{ operators: [], skip_reason: null }],
      },
    ];
    const out = reminderLib.formatContractMissingReminders({
      assistant_turns: turns,
      idTypeMap,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("KP-DEC-0001");
  });
});

// ---------------------------------------------------------------------------
// readKnowledgeTypeMap — fs-loader contract tests.
// ---------------------------------------------------------------------------
describe("cite-contract-reminder.cjs — readKnowledgeTypeMap", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-reminder-meta-"));
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns populated Map from a real agents.meta.json", () => {
    writeAgentsMeta(tempRoot, {
      "KT-DEC-0001": "decision",
      "KT-PIT-0007": "pitfall",
      "KT-MOD-0002": "model",
    });
    const map = reminderLib.readKnowledgeTypeMap(tempRoot);
    expect(map.size).toBe(3);
    expect(map.get("KT-DEC-0001")).toBe("decision");
    expect(map.get("KT-PIT-0007")).toBe("pitfall");
    expect(map.get("KT-MOD-0002")).toBe("model");
  });

  it("returns empty Map when agents.meta.json is missing", () => {
    const map = reminderLib.readKnowledgeTypeMap(tempRoot);
    expect(map.size).toBe(0);
  });

  it("returns empty Map when agents.meta.json contains invalid JSON", () => {
    writeFileSync(join(tempRoot, ".fabric", "agents.meta.json"), "{this is not json", "utf8");
    const map = reminderLib.readKnowledgeTypeMap(tempRoot);
    expect(map.size).toBe(0);
  });

  it("returns empty Map when projectRoot is invalid (empty / non-string)", () => {
    expect(reminderLib.readKnowledgeTypeMap("").size).toBe(0);
    // @ts-expect-error — deliberate runtime contract test
    expect(reminderLib.readKnowledgeTypeMap(null).size).toBe(0);
    // @ts-expect-error — deliberate runtime contract test
    expect(reminderLib.readKnowledgeTypeMap(undefined).size).toBe(0);
  });

  it("skips nodes missing description.knowledge_type", () => {
    const meta = {
      revision: "sha256:test",
      nodes: {
        "KT-DEC-0001": {
          file: ".fabric/knowledge/decisions/KT-DEC-0001.md",
          description: { knowledge_type: "decision" },
        },
        bootstrap: {
          file: "AGENTS.md",
          description: { summary: "bootstrap" }, // no knowledge_type
        },
      },
    };
    writeFileSync(
      join(tempRoot, ".fabric", "agents.meta.json"),
      JSON.stringify(meta),
      "utf8",
    );
    const map = reminderLib.readKnowledgeTypeMap(tempRoot);
    expect(map.size).toBe(1);
    expect(map.get("KT-DEC-0001")).toBe("decision");
    expect(map.has("bootstrap")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// emitCiteContractRemindersBestEffort — integration through fabric-hint.cjs
// including transcript read + stderr write + agents.meta lookup.
// ---------------------------------------------------------------------------
describe("fabric-hint.cjs — emitCiteContractRemindersBestEffort (integration)", () => {
  let tempRoot: string;
  let transcriptPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-reminder-int-"));
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    transcriptPath = join(tempRoot, "transcript.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("emits ⚠ KB:… line to provided stderr for decision cite without contract", () => {
    writeAgentsMeta(tempRoot, { "KT-DEC-0001": "decision" });
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "ping" },
      { role: "assistant", text: "KB: KT-DEC-0001 [recalled]\n\nbody" },
    ]);
    const stderr = new StderrCollector();
    const out = hook.emitCiteContractRemindersBestEffort(
      tempRoot,
      { session_id: "s1", transcript_path: transcriptPath },
      stderr,
    );
    expect(out).toHaveLength(1);
    expect(stderr.lines()).toHaveLength(1);
    expect(stderr.lines()[0]).toMatch(/^⚠ KB: KT-DEC-0001 /);
  });

  it("emits no reminder + no stderr when contract is satisfied with edit operator", () => {
    writeAgentsMeta(tempRoot, { "KT-DEC-0001": "decision" });
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "ping" },
      {
        role: "assistant",
        text: "KB: KT-DEC-0001 [recalled] → edit:src/foo.ts\n\nbody",
      },
    ]);
    const stderr = new StderrCollector();
    const out = hook.emitCiteContractRemindersBestEffort(
      tempRoot,
      { session_id: "s2", transcript_path: transcriptPath },
      stderr,
    );
    expect(out).toEqual([]);
    expect(stderr.chunks).toEqual([]);
  });

  it("never-throws: null stdinPayload → empty result, no stderr writes", () => {
    writeAgentsMeta(tempRoot, { "KT-DEC-0001": "decision" });
    const stderr = new StderrCollector();
    expect(() =>
      hook.emitCiteContractRemindersBestEffort(tempRoot, null, stderr),
    ).not.toThrow();
    expect(stderr.chunks).toEqual([]);
  });

  it("never-throws: missing transcript_path → empty result", () => {
    writeAgentsMeta(tempRoot, { "KT-DEC-0001": "decision" });
    const stderr = new StderrCollector();
    const out = hook.emitCiteContractRemindersBestEffort(
      tempRoot,
      { session_id: "no-transcript" },
      stderr,
    );
    expect(out).toEqual([]);
    expect(stderr.chunks).toEqual([]);
  });

  it("never-throws: missing agents.meta.json → empty result (no idTypeMap means no offenders)", () => {
    // No agents.meta.json written.
    writeTranscriptFixture(transcriptPath, [
      { role: "user", text: "ping" },
      { role: "assistant", text: "KB: KT-DEC-0001 [recalled]\n\nbody" },
    ]);
    const stderr = new StderrCollector();
    const out = hook.emitCiteContractRemindersBestEffort(
      tempRoot,
      { session_id: "no-meta", transcript_path: transcriptPath },
      stderr,
    );
    expect(out).toEqual([]);
    expect(stderr.chunks).toEqual([]);
  });
});
