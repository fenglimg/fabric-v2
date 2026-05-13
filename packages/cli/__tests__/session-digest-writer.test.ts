/**
 * v2.0.0-rc.7 T5: session-digest writer contract tests.
 *
 * The writer lives at templates/hooks/lib/session-digest-writer.cjs and is
 * invoked from the Stop hook (templates/hooks/fabric-hint.cjs) to persist a
 * compact per-session markdown digest under
 * .fabric/.cache/session-digests/<session_id>.md (≤5KB, atomic write,
 * best-effort).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const writerPath = fileURLToPath(
  new URL("../templates/hooks/lib/session-digest-writer.cjs", import.meta.url),
);

type WriterModule = {
  writeDigest: (opts: {
    projectRoot: string;
    session_id: string;
    title?: string;
    user_messages?: string[];
    edit_paths?: string[];
  }) => { written: boolean; path: string | null };
  renderDigest: (opts: {
    session_id: string;
    title?: string;
    user_messages?: string[];
    edit_paths?: string[];
  }) => string;
  CONSTANTS: {
    CACHE_REL: string;
    SIZE_CAP_BYTES: number;
    MAX_USER_MESSAGES: number;
    MAX_MSG_CHARS: number;
    MAX_EDIT_PATHS: number;
  };
};

const writer = require(writerPath) as WriterModule;

describe("session-digest-writer", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-digest-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("writes a digest file under .fabric/.cache/session-digests/<session_id>.md", () => {
    const result = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "session-abc",
      title: "Wave 2 schema migration",
      user_messages: ["init the digest", "make sure the cap holds"],
      edit_paths: ["packages/server/src/services/extract-knowledge.ts"],
    });

    expect(result.written).toBe(true);
    expect(result.path).toBe(
      join(tempRoot, ".fabric", ".cache", "session-digests", "session-abc.md"),
    );
    expect(existsSync(result.path!)).toBe(true);
    const body = readFileSync(result.path!, "utf8");
    expect(body).toMatch(/^# Wave 2 schema migration$/m);
    expect(body).toMatch(/Session: session-abc/);
    expect(body).toMatch(/## User messages \(top 10\)/);
    expect(body).toMatch(/- init the digest/);
    expect(body).toMatch(/## Edits/);
    expect(body).toMatch(
      /- packages\/server\/src\/services\/extract-knowledge\.ts/,
    );
  });

  it("caps file size at 5KB even with many long user messages", () => {
    // Generate 30 long messages, each near MAX_MSG_CHARS — total uncapped
    // would blow past 5KB. The writer must drop user_messages from the tail
    // until the file fits.
    const filler = "x".repeat(450);
    const longMessages: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      longMessages.push(`msg-${i} ${filler}`);
    }

    const result = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "session-big",
      title: "big session",
      user_messages: longMessages,
      edit_paths: ["a.ts", "b.ts"],
    });
    expect(result.written).toBe(true);
    const size = statSync(result.path!).size;
    expect(size).toBeLessThanOrEqual(writer.CONSTANTS.SIZE_CAP_BYTES);
    // Earliest messages preserved.
    const body = readFileSync(result.path!, "utf8");
    expect(body).toMatch(/msg-0/);
  });

  it("returns {written:false, path:null} when session_id is missing/invalid", () => {
    const r1 = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "",
      user_messages: ["x"],
    });
    expect(r1.written).toBe(false);
    expect(r1.path).toBeNull();

    const r2 = writer.writeDigest({
      projectRoot: tempRoot,
      // @ts-expect-error — runtime guard test
      session_id: undefined,
      user_messages: ["x"],
    });
    expect(r2.written).toBe(false);
  });

  it("returns {written:false, path:null} when projectRoot is empty", () => {
    const r = writer.writeDigest({
      projectRoot: "",
      session_id: "abc",
      user_messages: ["x"],
    });
    expect(r.written).toBe(false);
    expect(r.path).toBeNull();
  });

  it("sanitizes session_id to a safe filename (no path traversal)", () => {
    // The session_id "../../etc/passwd" must NOT escape the cache dir.
    const r = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "../../etc/passwd",
      user_messages: ["x"],
    });
    expect(r.written).toBe(true);
    expect(r.path).not.toBeNull();
    // The resolved path stays inside the cache dir.
    const cacheDir = join(tempRoot, ".fabric", ".cache", "session-digests");
    expect(r.path!.startsWith(cacheDir)).toBe(true);
    // No literal `..` segment survived.
    expect(r.path!).not.toMatch(/\.\./);
  });

  it("survives a non-existent cacheDir (creates it recursively)", () => {
    const newRoot = mkdtempSync(join(tmpdir(), "fabric-digest-no-cache-"));
    try {
      // No .fabric/.cache/session-digests pre-created — writeDigest must
      // create it via mkdirSync(recursive:true).
      const r = writer.writeDigest({
        projectRoot: newRoot,
        session_id: "fresh",
        user_messages: ["bootstrap"],
      });
      expect(r.written).toBe(true);
      expect(existsSync(r.path!)).toBe(true);
    } finally {
      rmSync(newRoot, { recursive: true, force: true });
    }
  });

  it("overwrites a prior digest on re-invoke (atomic replace semantics)", () => {
    const first = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "session-rerun",
      user_messages: ["first run"],
    });
    expect(first.written).toBe(true);
    const before = readFileSync(first.path!, "utf8");
    expect(before).toMatch(/first run/);

    const second = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "session-rerun",
      user_messages: ["second run"],
    });
    expect(second.written).toBe(true);
    expect(second.path).toBe(first.path);
    const after = readFileSync(second.path!, "utf8");
    expect(after).toMatch(/second run/);
    expect(after).not.toMatch(/first run/);
  });

  it("handles missing user_messages / edit_paths gracefully (empty markers)", () => {
    const r = writer.writeDigest({
      projectRoot: tempRoot,
      session_id: "session-empty",
      // Intentionally omit user_messages / edit_paths
    });
    expect(r.written).toBe(true);
    const body = readFileSync(r.path!, "utf8");
    expect(body).toMatch(/_\(no user messages captured\)_/);
    expect(body).toMatch(/_\(no edits captured\)_/);
  });

  it("does not write a file when the cache dir cannot be created (e.g. unwriteable projectRoot)", () => {
    // Pointing at a path that cannot be created — best-effort returns {written:false}.
    const result = writer.writeDigest({
      projectRoot: "/dev/null/cannot-create-here",
      session_id: "abc",
      user_messages: ["x"],
    });
    expect(result.written).toBe(false);
    expect(result.path).toBeNull();
  });
});

// Integration test — verify the Stop hook integration writes a digest when
// a stdin_payload (session_id + transcript_path) is supplied.
describe("fabric-hint.cjs — session-digest integration", () => {
  let tempRoot: string;
  const hookPath = fileURLToPath(
    new URL("../templates/hooks/fabric-hint.cjs", import.meta.url),
  );
  const hook = require(hookPath) as {
    main: (
      env: { cwd: string; now: Date; stdin_payload?: unknown },
      stdio: { stdout: { write: (chunk: string) => void } },
    ) => void;
  };

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "fabric-hint-digest-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("writes a session digest when stdin_payload provides session_id + transcript_path", () => {
    // Build a transcript JSONL with one user message + one Edit tool_use.
    const transcriptPath = join(tempRoot, "transcript.jsonl");
    const lines = [
      JSON.stringify({
        role: "user",
        content: "Goal: ship Wave 2 RC.7 work.",
      }),
      JSON.stringify({
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Working on it." },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "packages/server/src/services/extract-knowledge.ts" },
            },
          ],
        },
      }),
    ];
    writeFileSync(transcriptPath, lines.join("\n") + "\n", "utf8");

    const stdout = { write: () => undefined };
    hook.main(
      {
        cwd: tempRoot,
        now: new Date(),
        stdin_payload: {
          session_id: "integration-1",
          transcript_path: transcriptPath,
          hook_event_name: "Stop",
        },
      },
      { stdout },
    );

    const digestPath = join(
      tempRoot,
      ".fabric",
      ".cache",
      "session-digests",
      "integration-1.md",
    );
    expect(existsSync(digestPath)).toBe(true);
    const body = readFileSync(digestPath, "utf8");
    expect(body).toMatch(/Goal: ship Wave 2 RC\.7 work\./);
    expect(body).toMatch(/extract-knowledge\.ts/);
  });

  it("does not throw and does not write a digest when stdin_payload is null", () => {
    const stdout = { write: () => undefined };
    hook.main(
      { cwd: tempRoot, now: new Date(), stdin_payload: null },
      { stdout },
    );
    const cacheDir = join(tempRoot, ".fabric", ".cache", "session-digests");
    expect(existsSync(cacheDir)).toBe(false);
  });

  it("does not throw when transcript_path is missing/invalid (best-effort)", () => {
    const stdout = { write: () => undefined };
    hook.main(
      {
        cwd: tempRoot,
        now: new Date(),
        stdin_payload: {
          session_id: "no-transcript",
          transcript_path: "/path/that/does/not/exist.jsonl",
          hook_event_name: "Stop",
        },
      },
      { stdout },
    );
    // Digest is still written (with empty messages/edits markers) — the spec
    // says best-effort; rendering with empty inputs is the documented branch.
    const digestPath = join(
      tempRoot,
      ".fabric",
      ".cache",
      "session-digests",
      "no-transcript.md",
    );
    expect(existsSync(digestPath)).toBe(true);
  });
});
