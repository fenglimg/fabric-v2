/**
 * v2.0.0-rc.27 TASK-009 (audit §2.16): regression tests for the
 * `summarizeTranscript` parser in templates/hooks/fabric-hint.cjs.
 *
 * Prior to rc.27, the parser only understood Claude Code's transcript JSONL
 * shape (`{ type:"user", message:{ role, content } }`). When invoked on
 * Codex CLI transcripts (`{ type:"response_item", payload:{ type:"message",
 * role, content:[{type:"input_text"|"output_text", text}] } }`), every field
 * came back empty — producing the "no user messages captured" digests the
 * werewolf-minigame audit surfaced.
 *
 * ISS-20260713-041: path sandbox — fixtures write under FABRIC_TRANSCRIPT_ROOTS.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/fabric-hint.cjs", import.meta.url),
);

type Summary = {
  user_messages: string[];
  edit_paths: string[];
  title: string;
  assistant_turns: Array<{
    envelope_index: number;
    kb_line_raw: string | null;
    cite_ids: string[];
    cite_tags: string[];
    cite_commitments: unknown[];
  }>;
};

const { summarizeTranscript } = require(hookPath) as {
  summarizeTranscript: (path: string) => Summary;
};

const emptySummary = (): Summary => ({
  user_messages: [],
  edit_paths: [],
  title: "",
  assistant_turns: [],
});

/** Shared allowlisted temp root for this file (ISS-041 test seam). */
let allowedRoot: string;
const createdDirs: string[] = [];
const prevRoots = process.env.FABRIC_TRANSCRIPT_ROOTS;

beforeEach(() => {
  allowedRoot = mkdtempSync(join(tmpdir(), "fabric-summarize-root-"));
  createdDirs.push(allowedRoot);
  process.env.FABRIC_TRANSCRIPT_ROOTS = allowedRoot;
});

afterEach(() => {
  if (prevRoots === undefined) {
    delete process.env.FABRIC_TRANSCRIPT_ROOTS;
  } else {
    process.env.FABRIC_TRANSCRIPT_ROOTS = prevRoots;
  }
  while (createdDirs.length > 0) {
    const d = createdDirs.pop();
    if (d) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
});

function writeTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(allowedRoot, "case-"));
  createdDirs.push(dir);
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return path;
}

describe("summarizeTranscript — Claude Code shape", () => {
  it("extracts user_messages from { type:'user', message:{ role, content:string } }", () => {
    const path = writeTranscript([
      { type: "user", message: { role: "user", content: "hello world" } },
      {
        type: "user",
        message: { role: "user", content: "second msg" },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.user_messages).toEqual(["hello world", "second msg"]);
    expect(r.title).toBe("hello world");
  });

  it("harvests edit_paths from tool_use blocks inside message.content[]", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "ok" },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/repo/src/foo.ts" },
            },
            {
              type: "tool_use",
              name: "MultiEdit",
              input: {
                edits: [
                  { file_path: "/repo/src/bar.ts" },
                  { file_path: "/repo/src/baz.ts" },
                ],
              },
            },
          ],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.edit_paths).toEqual([
      "/repo/src/foo.ts",
      "/repo/src/bar.ts",
      "/repo/src/baz.ts",
    ]);
  });
});

describe("summarizeTranscript — Codex CLI shape (audit §2.16 regression)", () => {
  it("extracts user_messages from response_item/payload envelope", () => {
    const path = writeTranscript([
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "首条 codex 用户消息" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "second user prompt" }],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.user_messages).toEqual([
      "首条 codex 用户消息",
      "second user prompt",
    ]);
    expect(r.title).toBe("首条 codex 用户消息");
  });

  it("harvests edit_paths from apply_patch custom_tool_call payloads", () => {
    const patchBody = [
      "*** Begin Patch",
      "*** Update File: /repo/src/foo.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: /repo/src/new.ts",
      "+content",
      "*** Delete File: /repo/src/legacy.ts",
      "*** End Patch",
    ].join("\n");
    const path = writeTranscript([
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          input: patchBody,
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.edit_paths).toEqual([
      "/repo/src/foo.ts",
      "/repo/src/new.ts",
      "/repo/src/legacy.ts",
    ]);
  });

  it("captures assistant_turns + KB cite parse from output_text blocks", () => {
    const path = writeTranscript([
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "KB: KT-DEC-0001 [applied] → edit:src/foo.ts\n\nproceeding",
            },
          ],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.assistant_turns).toHaveLength(1);
    expect(r.assistant_turns[0].kb_line_raw).toBe(
      "KB: KT-DEC-0001 [applied] → edit:src/foo.ts",
    );
    expect(r.assistant_turns[0].cite_ids).toEqual(["KT-DEC-0001"]);
    expect(r.assistant_turns[0].cite_tags).toEqual(["applied"]);
  });

  // Leading multi-line KB: block (applied + dismissed) — previously only the
  // first line was parsed so dismissed was dropped (ccpm dogfood 2026-07-12).
  it("captures multi-line leading KB: applied + dismissed in one assistant turn", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: [
                "KB: team:KT-PIT-0014 [applied]",
                "KB: team:KT-DEC-0045 [dismissed:not-applicable]",
                "",
                "dismissed: team:KT-DEC-0045 (not-applicable)",
                "",
                "body prose follows",
              ].join("\n"),
            },
          ],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.assistant_turns).toHaveLength(1);
    expect(r.assistant_turns[0].kb_line_raw).toBe(
      "KB: team:KT-PIT-0014 [applied]\nKB: team:KT-DEC-0045 [dismissed:not-applicable]",
    );
    expect(r.assistant_turns[0].cite_ids).toEqual(["KT-PIT-0014", "KT-DEC-0045"]);
    expect(r.assistant_turns[0].cite_tags).toEqual(["applied", "dismissed"]);
  });

  it("ignores KB: lines that appear after prose (not leading)", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Done.\n\nKB: KT-DEC-0001 [applied]\n",
            },
          ],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.assistant_turns).toHaveLength(1);
    expect(r.assistant_turns[0].kb_line_raw).toBeNull();
    expect(r.assistant_turns[0].cite_ids).toEqual([]);
  });

  it("returns empty result on missing file (best-effort, no throw)", () => {
    // Missing path under allowlisted root still fail-closed empty (ENOENT).
    const missing = join(allowedRoot, "no-such-file.jsonl");
    const r = summarizeTranscript(missing);
    expect(r).toEqual(emptySummary());
  });
});

describe("summarizeTranscript — mixed-shape transcripts", () => {
  it("handles a transcript that mixes Claude Code + Codex envelopes", () => {
    const path = writeTranscript([
      { type: "user", message: { role: "user", content: "cc user msg" } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "codex user msg" }],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.user_messages).toEqual(["cc user msg", "codex user msg"]);
  });
});

describe("summarizeTranscript — ISS-041 path sandbox", () => {
  it("denies relative paths (fail-closed empty, no throw)", () => {
    const r = summarizeTranscript("relative/transcript.jsonl");
    expect(r).toEqual(emptySummary());
  });

  it("denies absolute paths outside allowlisted roots", () => {
    // Outside FABRIC_TRANSCRIPT_ROOTS (allowedRoot) — even if file exists.
    const outsideDir = mkdtempSync(join(tmpdir(), "fabric-summarize-outside-"));
    createdDirs.push(outsideDir);
    const outsidePath = join(outsideDir, "transcript.jsonl");
    writeFileSync(
      outsidePath,
      JSON.stringify({ type: "user", message: { role: "user", content: "secret" } }) + "\n",
      "utf8",
    );
    const r = summarizeTranscript(outsidePath);
    expect(r.user_messages).toEqual([]);
    expect(r).toEqual(emptySummary());
  });

  it("denies non-.jsonl suffix under allowlisted root", () => {
    const bad = join(allowedRoot, "notes.txt");
    writeFileSync(
      bad,
      JSON.stringify({ type: "user", message: { role: "user", content: "nope" } }) + "\n",
      "utf8",
    );
    const r = summarizeTranscript(bad);
    expect(r).toEqual(emptySummary());
  });

  it("allows absolute path under FABRIC_TRANSCRIPT_ROOTS temp root", () => {
    const path = writeTranscript([
      { type: "user", message: { role: "user", content: "allowed root ok" } },
    ]);
    const r = summarizeTranscript(path);
    expect(r.user_messages).toEqual(["allowed root ok"]);
    expect(r.title).toBe("allowed root ok");
  });

  // ISS-20260713-044: FABRIC_TRANSCRIPT_ROOTS=/ must not fully disable sandbox.
  it("denies FABRIC_TRANSCRIPT_ROOTS=/ (filesystem root is not allowlisted)", () => {
    process.env.FABRIC_TRANSCRIPT_ROOTS = "/";
    // File under /tmp is absolute and would pass if `/` were accepted as a root.
    const outsideDir = mkdtempSync(join(tmpdir(), "fabric-summarize-rootbypass-"));
    createdDirs.push(outsideDir);
    const outsidePath = join(outsideDir, "transcript.jsonl");
    writeFileSync(
      outsidePath,
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "should-not-read" },
      }) + "\n",
      "utf8",
    );
    const r = summarizeTranscript(outsidePath);
    expect(r).toEqual(emptySummary());
    // Also: getAllowedTranscriptRoots must not include `/` after filter.
    const { getAllowedTranscriptRoots } = require(
      fileURLToPath(new URL("../templates/hooks/lib/transcript-summary.cjs", import.meta.url)),
    ) as { getAllowedTranscriptRoots: () => string[] };
    expect(getAllowedTranscriptRoots().includes("/")).toBe(false);
  });

  // ISS-20260713-044: production ignores FABRIC_TRANSCRIPT_ROOTS entirely.
  it("ignores FABRIC_TRANSCRIPT_ROOTS outside test seam (NODE_ENV/FABRIC_TEST)", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFabricTest = process.env.FABRIC_TEST;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.FABRIC_TEST;
      // Even with a temp root in env, production must not honor it.
      process.env.FABRIC_TRANSCRIPT_ROOTS = allowedRoot;
      const path = writeTranscript([
        { type: "user", message: { role: "user", content: "prod-must-deny-temp-root" } },
      ]);
      const r = summarizeTranscript(path);
      expect(r).toEqual(emptySummary());
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevFabricTest === undefined) delete process.env.FABRIC_TEST;
      else process.env.FABRIC_TEST = prevFabricTest;
    }
  });

  // ISS-20260713-045: summarizeTranscript reads the resolved realpath, not the
  // unsanitized original (TOCTOU / symlink diverge).
  it("reads via realpath when path is a symlink under allowlisted root", () => {
    const { symlinkSync } = require("node:fs") as typeof import("node:fs");
    const realDir = mkdtempSync(join(allowedRoot, "real-"));
    createdDirs.push(realDir);
    const realPath = join(realDir, "transcript.jsonl");
    writeFileSync(
      realPath,
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "via-realpath" },
      }) + "\n",
      "utf8",
    );
    const linkDir = mkdtempSync(join(allowedRoot, "link-"));
    createdDirs.push(linkDir);
    const linkPath = join(linkDir, "transcript.jsonl");
    try {
      symlinkSync(realPath, linkPath);
    } catch {
      // Some CI environments disable symlink creation — skip soft.
      return;
    }
    const r = summarizeTranscript(linkPath);
    expect(r.user_messages).toEqual(["via-realpath"]);
  });
});
