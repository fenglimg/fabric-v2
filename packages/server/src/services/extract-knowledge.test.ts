import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { extractKnowledge } from "./extract-knowledge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("extractKnowledge", () => {
  it("extractKnowledge_writes_pending_file_without_id", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-001",
      recent_paths: ["packages/server/src/index.ts"],
      user_messages_summary: "We decided to keep idempotency at the triple level.",
      type: "decisions",
      slug: "triple-idempotency",
    });

    expect(result.pending_path).toBe(".fabric/knowledge/pending/decisions/triple-idempotency.md");
    expect(result.idempotency_key).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const fileContents = await readFile(join(projectRoot, result.pending_path), "utf8");
    // Q2 late-bind: NO `id:` field in frontmatter.
    expect(fileContents).not.toMatch(/^id:/mu);
    expect(fileContents).toMatch(/^type: decisions$/mu);
    expect(fileContents).toMatch(/^maturity: draft$/mu);
    expect(fileContents).toMatch(/^layer: team$/mu);
    expect(fileContents).toMatch(/^source_session: sess-001$/mu);
    expect(fileContents).toMatch(/^tags: \[\]$/mu);
    expect(fileContents).toMatch(/^x-fabric-idempotency-key: sha256:[0-9a-f]{64}$/mu);
    // Body has the initial evidence section.
    expect(fileContents).toMatch(/^## Evidence \(call 1\)$/mu);

    const ledger = await readEventLedger(projectRoot, { event_type: "knowledge_proposed" });
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({
      event_type: "knowledge_proposed",
      correlation_id: "sess-001",
      session_id: "sess-001",
      reason: "extract_knowledge:triple-idempotency",
    });
  });

  it("extractKnowledge_is_idempotent_on_triple", async () => {
    const projectRoot = await createTempProject();

    const first = await extractKnowledge(projectRoot, {
      source_session: "sess-002",
      recent_paths: ["a.ts"],
      user_messages_summary: "First-call summary body.",
      type: "guidelines",
      slug: "naming-pattern",
    });
    const second = await extractKnowledge(projectRoot, {
      source_session: "sess-002",
      recent_paths: ["b.ts"],
      // Different summary on purpose — body MUST NOT be replaced.
      user_messages_summary: "Second-call summary body — should append, not overwrite.",
      type: "guidelines",
      slug: "naming-pattern",
    });

    // Mirror scan-init.test.ts:202 reruns_are_no_op_with_zero_diff style:
    // identical triple yields identical idempotency_key + pending_path.
    expect(second.idempotency_key).toBe(first.idempotency_key);
    expect(second.pending_path).toBe(first.pending_path);

    const body = await readFile(join(projectRoot, first.pending_path), "utf8");
    // Both summaries appear (append-evidence semantics).
    expect(body).toMatch(/First-call summary body\./u);
    expect(body).toMatch(/Second-call summary body — should append, not overwrite\./u);
    // Two evidence sections.
    expect(body).toMatch(/^## Evidence \(call 1\)$/mu);
    expect(body).toMatch(/^## Evidence \(call 2\)$/mu);

    const ledger = await readEventLedger(projectRoot, { event_type: "knowledge_proposed" });
    expect(ledger.events).toHaveLength(2);
    for (const event of ledger.events) {
      expect(event).toMatchObject({
        correlation_id: "sess-002",
        session_id: "sess-002",
        reason: "extract_knowledge:naming-pattern",
      });
    }
  });

  it("extractKnowledge_emits_archive_attempted_on_empty_summary", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-003",
      recent_paths: [],
      user_messages_summary: "   \n  \t  ",
      type: "pitfalls",
      slug: "empty-input",
    });

    expect(result.pending_path).toBe("");
    expect(result.idempotency_key).toMatch(/^sha256:/u);

    const proposed = await readEventLedger(projectRoot, { event_type: "knowledge_proposed" });
    expect(proposed.events).toHaveLength(0);

    const archive = await readEventLedger(projectRoot, { event_type: "knowledge_archive_attempted" });
    expect(archive.events).toHaveLength(1);
    expect(archive.events[0]).toMatchObject({
      event_type: "knowledge_archive_attempted",
      correlation_id: "sess-003",
      session_id: "sess-003",
      reason: "extract_knowledge:empty-input",
    });
  });

  it("extractKnowledge_sanitizes_slug_to_kebab_case", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-004",
      recent_paths: ["x.ts"],
      user_messages_summary: "Some content.",
      type: "models",
      // Mix of upper-case, spaces, slashes, punctuation, accented chars.
      slug: "  Multi Word //  Slug!! With    Punctuation  ",
    });

    expect(result.pending_path).toBe(
      ".fabric/knowledge/pending/models/multi-word-slug-with-punctuation.md",
    );
  });

  // ---- branch-coverage tests (rc.2 gate) ----

  it("extractKnowledge_handles_undefined_summary_via_nullish_coalesce", async () => {
    const projectRoot = await createTempProject();

    // user_messages_summary undefined exercises L46 nullish-coalesce branch.
    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-undef",
      recent_paths: [],
      // intentionally omit user_messages_summary (typed as optional in schema)
      type: "decisions",
      slug: "missing-summary",
    } as Parameters<typeof extractKnowledge>[1]);

    // Empty summary path → no pending file written, archive_attempted emitted.
    expect(result.pending_path).toBe("");
    const archive = await readEventLedger(projectRoot, { event_type: "knowledge_archive_attempted" });
    expect(archive.events).toHaveLength(1);
  });

  it("extractKnowledge_treats_fully_punctuated_slug_as_empty", async () => {
    const projectRoot = await createTempProject();

    // Slug like "!!!" sanitizes to "" — exercises slugIsEmpty branch (L48)
    // AND the "sanitizedSlug || input.slug" fallback in the reason field.
    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-punct",
      recent_paths: [],
      user_messages_summary: "Some non-empty body.",
      type: "decisions",
      slug: "!!!@@@###",
    });

    expect(result.pending_path).toBe("");
    const archive = await readEventLedger(projectRoot, { event_type: "knowledge_archive_attempted" });
    expect(archive.events).toHaveLength(1);
    // Reason falls back to input.slug when sanitizedSlug is empty.
    expect(archive.events[0]?.reason).toBe("extract_knowledge:!!!@@@###");
  });

  it("extractKnowledge_throws_on_collision_with_different_idempotency_key", async () => {
    // rc.4 TASK-006 fix (b): contract changed — collision now throws loudly
    // rather than silently overwriting. This test pins the new contract on
    // the L88-92 branch (existing pending file with mismatched idempotency
    // key from any source: stale seed, prior session, manual edit).
    const projectRoot = await createTempProject();

    const dir = join(projectRoot, ".fabric/knowledge/pending/decisions");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "collision.md");
    const stale = [
      "---",
      "type: decisions",
      "x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "---",
      "",
      "Stale body must be preserved (no silent overwrite).",
    ].join("\n");
    await writeFile(target, stale, "utf8");

    await expect(
      extractKnowledge(projectRoot, {
        source_session: "sess-collision",
        recent_paths: [],
        user_messages_summary: "Fresh body must NOT win.",
        type: "decisions",
        slug: "collision",
      }),
    ).rejects.toThrow(/slug collision/u);

    // Stale file untouched (no data loss).
    const after = await readFile(target, "utf8");
    expect(after).toBe(stale);
  });

  it("extractKnowledge_renders_no_recent_paths_marker_when_recent_paths_empty", async () => {
    const projectRoot = await createTempProject();

    // recent_paths=[] exercises the empty-array branch in renderEvidenceBlock.
    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-empty-paths",
      recent_paths: [],
      user_messages_summary: "Body without recent paths.",
      type: "guidelines",
      slug: "no-paths",
    });

    const body = await readFile(join(projectRoot, result.pending_path), "utf8");
    expect(body).toMatch(/_\(no recent paths reported\)_/u);
  });

  it("extractKnowledge_handles_existing_file_without_trailing_newline", async () => {
    const projectRoot = await createTempProject();

    // First write to establish an entry.
    const first = await extractKnowledge(projectRoot, {
      source_session: "sess-no-nl",
      recent_paths: ["a.ts"],
      user_messages_summary: "First body.",
      type: "guidelines",
      slug: "no-newline",
    });

    // Mutate the file in-place to remove the trailing newline — exercises
    // the L194 false branch (existing.endsWith("\n") === false).
    const path = join(projectRoot, first.pending_path);
    const original = await readFile(path, "utf8");
    const stripped = original.replace(/\n+$/u, "");
    await writeFile(path, stripped, "utf8");

    const second = await extractKnowledge(projectRoot, {
      source_session: "sess-no-nl",
      recent_paths: ["b.ts"],
      user_messages_summary: "Second body, appended.",
      type: "guidelines",
      slug: "no-newline",
    });
    expect(second.pending_path).toBe(first.pending_path);

    const body = await readFile(path, "utf8");
    expect(body).toMatch(/^## Evidence \(call 1\)$/mu);
    expect(body).toMatch(/^## Evidence \(call 2\)$/mu);
  });

  it("extractKnowledge_throws_on_existing_file_without_frontmatter", async () => {
    // rc.4 TASK-006 fix (b): file at destination with no parseable
    // idempotency key is still a collision — the missing key reads as
    // undefined, never matches the incoming key, so the throw branch fires.
    // This is conservative: a manual / non-Fabric file at the pending path
    // should NOT be silently clobbered.
    const projectRoot = await createTempProject();
    const dir = join(projectRoot, ".fabric/knowledge/pending/decisions");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "no-frontmatter.md");
    const original = "Body without any frontmatter at all.\n";
    await writeFile(target, original, "utf8");

    await expect(
      extractKnowledge(projectRoot, {
        source_session: "sess-no-fm",
        recent_paths: [],
        user_messages_summary: "Replacement body.",
        type: "decisions",
        slug: "no-frontmatter",
      }),
    ).rejects.toThrow(/slug collision/u);

    const after = await readFile(target, "utf8");
    expect(after).toBe(original);
  });

  it("extractKnowledge_swallows_event_emission_failure_silently", async () => {
    const projectRoot = await createTempProject();

    // Make the .fabric directory unwriteable so appendEventLedgerEvent
    // cannot persist — extractKnowledge must still succeed (best-effort).
    const fabricDir = join(projectRoot, ".fabric");
    await mkdir(fabricDir, { recursive: true });
    // Pre-create the events dir as a regular file so ledger write fails.
    await writeFile(join(fabricDir, "events.jsonl"), "", "utf8");
    // Then chmod the file read-only-ish (no write) — best-effort across
    // platforms; on macOS/Linux this prevents append.
    try {
      await chmod(join(fabricDir, "events.jsonl"), 0o400);
    } catch {
      // some filesystems ignore chmod; skip the assertion below if so.
    }

    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-evt-fail",
      recent_paths: ["a.ts"],
      user_messages_summary: "Body that succeeds writing the pending file.",
      type: "decisions",
      slug: "evt-fail",
    });

    // The pending file write is the source of truth — that succeeds.
    expect(result.pending_path).toBe(".fabric/knowledge/pending/decisions/evt-fail.md");
    const body = await readFile(join(projectRoot, result.pending_path), "utf8");
    expect(body).toMatch(/Body that succeeds writing the pending file\./u);

    // Restore perms so afterEach cleanup can rm-rf.
    try {
      await chmod(join(fabricDir, "events.jsonl"), 0o644);
    } catch {
      // ignore
    }
  });

  it("extractKnowledge_truncates_long_slug_to_max_40_chars", async () => {
    const projectRoot = await createTempProject();

    // 60-char slug — exercises L132 slice + replace path.
    const longSlug = "a-very-long-slug-name-with-many-words-going-far-beyond-forty";
    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-long",
      recent_paths: [],
      user_messages_summary: "Body.",
      type: "decisions",
      slug: longSlug,
    });

    // Pending path's slug component is at most 40 chars.
    const slugFromPath = result.pending_path
      .replace(".fabric/knowledge/pending/decisions/", "")
      .replace(/\.md$/, "");
    expect(slugFromPath.length).toBeLessThanOrEqual(40);
    expect(slugFromPath.length).toBeGreaterThan(0);
    // Trailing dash (if slice landed on one) must be stripped.
    expect(slugFromPath).not.toMatch(/-$/u);
  });

  // --------------------------------------------------------------------
  // rc.4 TASK-006 fix (b): slug-collision throws loudly instead of
  // silently overwriting a pre-existing pending file with a different
  // idempotency_key (different source_session and/or summary). Two distinct
  // triples that sanitize to the same slug must NOT clobber each other.
  // --------------------------------------------------------------------
  it("extractKnowledge_throws_loudly_on_slug_collision_across_sessions", async () => {
    const projectRoot = await createTempProject();

    // First call — establishes the pending file under a sanitized slug.
    const first = await extractKnowledge(projectRoot, {
      source_session: "sess-A",
      recent_paths: ["a.ts"],
      user_messages_summary: "Original entry from session A.",
      type: "decisions",
      slug: "shared-slug",
    });
    expect(first.pending_path).toBe(
      ".fabric/knowledge/pending/decisions/shared-slug.md",
    );
    const originalBody = await readFile(
      join(projectRoot, first.pending_path),
      "utf8",
    );

    // Second call with a DIFFERENT source_session under the same sanitized
    // slug → different idempotency_key → must throw, not overwrite.
    await expect(
      extractKnowledge(projectRoot, {
        source_session: "sess-B",
        recent_paths: ["b.ts"],
        user_messages_summary: "Conflicting entry from session B.",
        type: "decisions",
        slug: "shared-slug",
      }),
    ).rejects.toThrow(/slug collision/u);

    // Verify the original file is untouched (no silent data loss).
    const after = await readFile(
      join(projectRoot, first.pending_path),
      "utf8",
    );
    expect(after).toBe(originalBody);
    expect(after).toMatch(/Original entry from session A\./u);
    expect(after).not.toMatch(/Conflicting entry from session B\./u);

    // Observability: a knowledge_archive_attempted event with the
    // slug-collision reason should be emitted before throw.
    const ledger = await readEventLedger(projectRoot, {
      event_type: "knowledge_archive_attempted",
    });
    expect(ledger.events.length).toBeGreaterThanOrEqual(1);
    expect(
      ledger.events.some((e) =>
        ((e as { reason?: string }).reason ?? "").includes("slug-collision"),
      ),
    ).toBe(true);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-extract-knowledge-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
