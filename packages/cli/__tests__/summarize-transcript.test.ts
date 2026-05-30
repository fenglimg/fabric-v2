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
 */

import { describe, expect, it } from "vitest";
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

function writeTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fabric-summarize-"));
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
              text: "KB: KT-DEC-0001 [recalled] → edit:src/foo.ts\n\nproceeding",
            },
          ],
        },
      },
    ]);
    const r = summarizeTranscript(path);
    expect(r.assistant_turns).toHaveLength(1);
    expect(r.assistant_turns[0].kb_line_raw).toBe(
      "KB: KT-DEC-0001 [recalled] → edit:src/foo.ts",
    );
    expect(r.assistant_turns[0].cite_ids).toEqual(["KT-DEC-0001"]);
    // v2.1.0-rc.1 (ADJ-P4-1): legacy [recalled] input remaps to [applied].
    expect(r.assistant_turns[0].cite_tags).toEqual(["applied"]);
  });

  it("returns empty result on missing file (best-effort, no throw)", () => {
    const r = summarizeTranscript("/no/such/file.jsonl");
    expect(r.user_messages).toEqual([]);
    expect(r.edit_paths).toEqual([]);
    expect(r.assistant_turns).toEqual([]);
    expect(r.title).toBe("");
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
