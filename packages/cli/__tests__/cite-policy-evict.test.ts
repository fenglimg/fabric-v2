/**
 * v2.1 ⑤ cite-redesign (P5) — unit tests for the recall-based cite-accounting
 * hook (packages/cli/templates/hooks/cite-policy-evict.cjs).
 *
 * The rc.34 turn-counter UserPromptSubmit reminder was replaced by a
 * PreToolUse(Edit/Write/MultiEdit) recall-aware nudge. The three behaviours the
 * redesign must guarantee (C1 done_when):
 *
 *   1. recall → edit  : an in-session fab_recall whose target paths overlap the
 *      edit target makes the edit "recall-backed" → NO nudge (the citation is
 *      auto-accounted from the recall→edit join; doctor C3 reconstructs it).
 *   2. edit, no recall: no overlapping recall → soft nudge "改前先 fab_recall".
 *   3. manual override: a hand-written `KB:` line (observed as an
 *      assistant_turn_observed event with cite_ids) still suppresses the nudge —
 *      the legacy explicit-cite path is honored (back-compat).
 *
 * Every defensive branch must keep the hook silent (never block the edit).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const hook = require("../templates/hooks/cite-policy-evict.cjs") as {
  extractPaths: (toolInput: unknown) => string[];
  extractToolName: (payload: unknown) => string | null;
  resolveSessionId: (payload: unknown, env?: unknown) => string;
  readNudgeEnabled: (cwd: string) => boolean;
  readWindowMinutes: (cwd: string) => number;
  readIgnoreGlobs: (cwd: string) => string[];
  globToRegExp: (glob: string) => RegExp;
  pathIsIgnored: (p: string, globs: string[]) => boolean;
  readEventsLedger: (cwd: string) => Array<Record<string, unknown>>;
  normalizeForCompare: (p: string, root?: string) => string;
  pathsOverlap: (recall: unknown, edit: unknown, root?: string) => boolean;
  evaluateRecallCite: (args: {
    events: Array<Record<string, unknown>>;
    editPaths: string[];
    sessionId: string;
    nowMs: number;
    windowMs: number;
    projectRoot?: string;
  }) => { recallBacked: boolean; recalledIds: string[]; matchedRecallTs: number | null; manualCited: boolean };
  renderNudge: (editPaths: string[]) => string;
  main: (
    env?: {
      cwd?: string;
      payload?: unknown;
      nowMs?: number;
      forceClaudeCode?: boolean;
      stdio?: { stdout?: { write: (s: string) => boolean | void }; stderr?: { write: (s: string) => boolean | void } };
    },
  ) => Promise<void>;
};

let tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function mkTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cite-recall-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(cwd: string, body: object): void {
  const dir = join(cwd, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fabric-config.json"), JSON.stringify(body));
}

function writeEvents(cwd: string, events: Array<Record<string, unknown>>): void {
  const dir = join(cwd, ".fabric");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

class Capture {
  chunks: string[] = [];
  write = (s: string): boolean => {
    this.chunks.push(s);
    return true;
  };
  joined(): string {
    return this.chunks.join("");
  }
}

const NOW = 1_900_000_000_000;
function plannedEvent(sessionId: string, ts: number, targetPaths: string[], ids: string[]) {
  return {
    kind: "fabric-event",
    id: `event:${ts}`,
    ts,
    schema_version: 1,
    session_id: sessionId,
    event_type: "knowledge_context_planned",
    target_paths: targetPaths,
    required_stable_ids: [],
    ai_selectable_stable_ids: ids,
    final_stable_ids: ids,
  };
}
function turnEvent(sessionId: string, ts: number, citeIds: string[]) {
  return {
    kind: "fabric-event",
    id: `event:${ts}`,
    ts,
    schema_version: 1,
    session_id: sessionId,
    event_type: "assistant_turn_observed",
    kb_line_raw: citeIds.length > 0 ? `KB: ${citeIds[0]} [applied]` : null,
    cite_ids: citeIds,
    cite_tags: citeIds.length > 0 ? ["applied"] : [],
    turn_id: "t1",
    timestamp: new Date(ts).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

describe("path overlap", () => {
  it("matches identical relative paths", () => {
    expect(hook.pathsOverlap(["src/a.ts"], ["src/a.ts"])).toBe(true);
  });
  it("matches abs edit vs rel recall (suffix)", () => {
    expect(hook.pathsOverlap(["src/a.ts"], ["/Users/x/proj/src/a.ts"], "/Users/x/proj")).toBe(true);
  });
  it("matches a recall directory covering the edited file", () => {
    expect(hook.pathsOverlap(["src"], ["src/a.ts"])).toBe(true);
  });
  it("does NOT match unrelated paths", () => {
    expect(hook.pathsOverlap(["src/a.ts"], ["src/b.ts"])).toBe(false);
  });
  it("does NOT match on basename alone", () => {
    expect(hook.pathsOverlap(["lib/util.ts"], ["src/util.ts"])).toBe(false);
  });
});

describe("extractPaths", () => {
  it("scalar file_path", () => {
    expect(hook.extractPaths({ file_path: "src/a.ts" })).toEqual(["src/a.ts"]);
  });
  it("MultiEdit edits[]", () => {
    expect(hook.extractPaths({ edits: [{ file_path: "src/a.ts" }, { file_path: "src/b.ts" }] })).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
  it("empty on no recognizable shape", () => {
    expect(hook.extractPaths({})).toEqual([]);
  });
});

describe("evaluateRecallCite", () => {
  it("recall→edit overlap → recallBacked with recalled ids", () => {
    const events = [plannedEvent("S1", NOW - 5_000, ["src/a.ts"], ["KT-DEC-0007"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.recallBacked).toBe(true);
    expect(d.recalledIds).toEqual(["KT-DEC-0007"]);
    expect(d.matchedRecallTs).toBe(NOW - 5_000);
    expect(d.manualCited).toBe(false);
  });

  it("recall in a DIFFERENT session does not count", () => {
    const events = [plannedEvent("OTHER", NOW - 5_000, ["src/a.ts"], ["KT-DEC-0007"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.recallBacked).toBe(false);
  });

  it("recall OUTSIDE the window does not count", () => {
    const events = [plannedEvent("S1", NOW - 60 * 60_000, ["src/a.ts"], ["KT-DEC-0007"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.recallBacked).toBe(false);
  });

  it("windowMs<=0 means unbounded — an old recall still counts", () => {
    const events = [plannedEvent("S1", NOW - 24 * 60 * 60_000, ["src/a.ts"], ["KT-DEC-0007"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 0 });
    expect(d.recallBacked).toBe(true);
  });

  it("recall of a non-overlapping path → not recallBacked", () => {
    const events = [plannedEvent("S1", NOW - 5_000, ["src/other.ts"], ["KT-DEC-0007"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.recallBacked).toBe(false);
  });

  it("manual KB: line (assistant_turn_observed with cite_ids) → manualCited", () => {
    const events = [turnEvent("S1", NOW - 1_000, ["KT-DEC-0001"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.manualCited).toBe(true);
    expect(d.recallBacked).toBe(false);
  });

  it("empty cite_ids turn → not manualCited", () => {
    const events = [turnEvent("S1", NOW - 1_000, [])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.manualCited).toBe(false);
  });

  it("future recall (ts > now) is ignored", () => {
    const events = [plannedEvent("S1", NOW + 5_000, ["src/a.ts"], ["KT-DEC-0007"])];
    const d = hook.evaluateRecallCite({ events, editPaths: ["src/a.ts"], sessionId: "S1", nowMs: NOW, windowMs: 30 * 60_000 });
    expect(d.recallBacked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// main() — the three required behaviours, end to end via the events ledger
// ---------------------------------------------------------------------------

describe("main() recall-based nudge", () => {
  const editPayload = (sessionId: string) => ({
    tool_name: "Edit",
    tool_input: { file_path: "src/a.ts" },
    session_id: sessionId,
  });

  it("1. recall → edit: NO nudge (auto-cited)", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, [plannedEvent("S1", NOW - 5_000, ["src/a.ts"], ["KT-DEC-0007"])]);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({ cwd, payload: editPayload("S1"), nowMs: NOW, forceClaudeCode: true, stdio: { stdout, stderr } });
    expect(stdout.joined()).toBe("");
    expect(stderr.joined()).toBe("");
  });

  it("2. edit, no recall: soft nudge (Claude Code stdout envelope)", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, []);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({ cwd, payload: editPayload("S1"), nowMs: NOW, forceClaudeCode: true, stdio: { stdout, stderr } });
    const out = stdout.joined();
    expect(out).toContain("hookSpecificOutput");
    expect(out).toContain("PreToolUse");
    expect(out).toContain("fab_recall");
    // valid JSON envelope
    expect(() => JSON.parse(out.trim())).not.toThrow();
  });

  it("2b. edit, no recall on non-Claude client: nudge to stderr", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, []);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({ cwd, payload: editPayload("S1"), nowMs: NOW, forceClaudeCode: false, stdio: { stdout, stderr } });
    expect(stdout.joined()).toBe("");
    expect(stderr.joined()).toContain("fab_recall");
  });

  it("3. manual KB: override → NO nudge", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, [turnEvent("S1", NOW - 1_000, ["KT-DEC-0001"])]);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({ cwd, payload: editPayload("S1"), nowMs: NOW, forceClaudeCode: true, stdio: { stdout, stderr } });
    expect(stdout.joined()).toBe("");
    expect(stderr.joined()).toBe("");
  });

  it("non-edit tool → silent", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, []);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({
      cwd,
      payload: { tool_name: "Bash", tool_input: { command: "ls" }, session_id: "S1" },
      nowMs: NOW,
      forceClaudeCode: true,
      stdio: { stdout, stderr },
    });
    expect(stdout.joined()).toBe("");
    expect(stderr.joined()).toBe("");
  });

  it("feature off (cite_recall_nudge=false) → silent even with no recall", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_recall_nudge: false });
    writeEvents(cwd, []);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({ cwd, payload: editPayload("S1"), nowMs: NOW, forceClaudeCode: true, stdio: { stdout, stderr } });
    expect(stdout.joined()).toBe("");
    expect(stderr.joined()).toBe("");
  });

  it("missing events ledger → still nudges (no recall observed), never throws", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({ cwd, payload: editPayload("S1"), nowMs: NOW, forceClaudeCode: true, stdio: { stdout, stderr } });
    expect(stdout.joined()).toContain("fab_recall");
  });
});

describe("config readers", () => {
  it("readNudgeEnabled defaults true", () => {
    const cwd = mkTemp();
    expect(hook.readNudgeEnabled(cwd)).toBe(true);
  });
  it("readNudgeEnabled honors explicit false", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_recall_nudge: false });
    expect(hook.readNudgeEnabled(cwd)).toBe(false);
  });
  it("readWindowMinutes defaults 30", () => {
    const cwd = mkTemp();
    expect(hook.readWindowMinutes(cwd)).toBe(30);
  });
  it("readWindowMinutes honors override", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_recall_window_minutes: 60 });
    expect(hook.readWindowMinutes(cwd)).toBe(60);
  });
});

// F2 — meta/orchestration paths are exempt from the nudge.
describe("F2 cite_nudge_ignore_globs", () => {
  it("readIgnoreGlobs defaults to the built-in .workflow exemption", () => {
    const cwd = mkTemp();
    expect(hook.readIgnoreGlobs(cwd)).toEqual([".workflow/**"]);
  });

  it("readIgnoreGlobs MERGES user globs with the default (never shrinks it)", () => {
    const cwd = mkTemp();
    writeConfig(cwd, { cite_nudge_ignore_globs: ["docs/**", ".workflow/**"] });
    const globs = hook.readIgnoreGlobs(cwd);
    expect(globs).toContain(".workflow/**"); // default always retained
    expect(globs).toContain("docs/**");
    // de-duped: the user-supplied ".workflow/**" does not appear twice
    expect(globs.filter((g) => g === ".workflow/**").length).toBe(1);
  });

  it("globToRegExp: ** crosses segments, * stays within one", () => {
    expect(hook.globToRegExp(".workflow/**").test(".workflow/a/b.md")).toBe(true);
    expect(hook.globToRegExp(".workflow/**").test(".workflow/x.md")).toBe(true);
    expect(hook.globToRegExp("*.md").test("a/b.md")).toBe(false); // * does not cross /
    expect(hook.globToRegExp("*.md").test("b.md")).toBe(true);
    expect(hook.globToRegExp(".workflow/**").test("src/a.ts")).toBe(false);
  });

  it("pathIsIgnored matches against the glob set", () => {
    expect(hook.pathIsIgnored(".workflow/notes.md", [".workflow/**"])).toBe(true);
    expect(hook.pathIsIgnored("src/a.ts", [".workflow/**"])).toBe(false);
  });

  it("main(): editing a .workflow file is silent (no recall, no nudge)", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, []);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({
      cwd,
      payload: { tool_name: "Edit", tool_input: { file_path: ".workflow/.scratchpad/x.md" }, session_id: "S1" },
      nowMs: NOW,
      forceClaudeCode: true,
      stdio: { stdout, stderr },
    });
    expect(stdout.joined()).toBe("");
    expect(stderr.joined()).toBe("");
  });

  it("main(): mixed batch still nudges, naming only the non-exempt target", async () => {
    const cwd = mkTemp();
    writeConfig(cwd, {});
    writeEvents(cwd, []);
    const stdout = new Capture();
    const stderr = new Capture();
    await hook.main({
      cwd,
      payload: {
        tool_name: "MultiEdit",
        tool_input: { edits: [{ file_path: ".workflow/meta.json" }, { file_path: "src/a.ts" }] },
        session_id: "S1",
      },
      nowMs: NOW,
      forceClaudeCode: true,
      stdio: { stdout, stderr },
    });
    const out = stdout.joined();
    expect(out).toContain("fab_recall");
    expect(out).toContain("src/a.ts");
    expect(out).not.toContain(".workflow/meta.json");
  });
});
