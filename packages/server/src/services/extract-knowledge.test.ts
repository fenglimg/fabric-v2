import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEventLedger } from "./event-ledger.js";
import { extractKnowledge, pendingBase } from "./extract-knowledge.js";
import type { FabExtractKnowledgeInput } from "@fenglimg/fabric-shared/schemas/api-contracts";
import type { KnowledgeArchiveAttemptedEvent } from "@fenglimg/fabric-shared";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// rc.5 B1: redirect personal-root resolution into a tempdir so tests writing
// to the personal pending root never touch the developer's real ~/.fabric/.
// Mirrors review.test.ts:18-22 setup.
beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-extract-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

// v2.0.0-rc.7 T6/T5 test helper: every extractKnowledge call now requires
// proposed_reason + session_context. This helper supplies sensible defaults so
// individual tests stay focused on the behaviour under test. Tests that want
// to exercise the new fields can override here.
function buildInput(partial: Partial<FabExtractKnowledgeInput>): FabExtractKnowledgeInput {
  return {
    source_session: partial.source_session ?? "sess-test",
    recent_paths: partial.recent_paths ?? [],
    user_messages_summary: partial.user_messages_summary ?? "Test summary body.",
    type: partial.type ?? "decisions",
    slug: partial.slug ?? "test-slug",
    layer: partial.layer,
    proposed_reason: partial.proposed_reason ?? "diagnostic-then-fix",
    session_context:
      partial.session_context ??
      "Session goal: validate extract-knowledge. Turning point: contract evolved at rc.7 to capture reason + context.",
    source_sessions: partial.source_sessions,
  } as FabExtractKnowledgeInput;
}

describe("extractKnowledge", () => {
  it("extractKnowledge_writes_pending_file_without_id", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-001",
      recent_paths: ["packages/server/src/index.ts"],
      user_messages_summary: "We decided to keep idempotency at the triple level.",
      type: "decisions",
      slug: "triple-idempotency",
      proposed_reason: "decision-confirmation",
      session_context:
        "Session goal: lock idempotency contract.\nTurning point: chose triple-keyed sha256 over single-string hash to prevent slug collisions across sessions.",
    }));

    expect(result.pending_path).toBe(".fabric/knowledge/pending/decisions/triple-idempotency.md");
    expect(result.idempotency_key).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const fileContents = await readFile(join(projectRoot, result.pending_path), "utf8");
    // Q2 late-bind: NO `id:` field in frontmatter.
    expect(fileContents).not.toMatch(/^id:/mu);
    expect(fileContents).toMatch(/^type: decisions$/mu);
    expect(fileContents).toMatch(/^maturity: draft$/mu);
    expect(fileContents).toMatch(/^layer: team$/mu);
    // v2.0.0-rc.7 T5: array form, not single string.
    expect(fileContents).toMatch(/^source_sessions: \["sess-001"\]$/mu);
    // v2.0.0-rc.7 T6: proposed_reason in frontmatter.
    expect(fileContents).toMatch(/^proposed_reason: decision-confirmation$/mu);
    expect(fileContents).toMatch(/^tags: \[\]$/mu);
    expect(fileContents).toMatch(/^x-fabric-idempotency-key: sha256:[0-9a-f]{64}$/mu);
    // v2.0.0-rc.7 T6: body section order — Summary / Why proposed / Session context / Evidence
    expect(fileContents).toMatch(/^## Summary$/mu);
    expect(fileContents).toMatch(/^## Why proposed$/mu);
    expect(fileContents).toMatch(/^## Session context$/mu);
    expect(fileContents).toMatch(/^## Evidence$/mu);
    // No more `## Evidence (call N)` blocks.
    expect(fileContents).not.toMatch(/^## Evidence \(call \d+\)$/mu);
    // Why proposed line includes enum + 1-line description.
    expect(fileContents).toMatch(/decision-confirmation — /u);

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

    const first = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-002",
      recent_paths: ["a.ts"],
      user_messages_summary: "First-call summary body.",
      type: "guidelines",
      slug: "naming-pattern",
    }));
    const second = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-002",
      recent_paths: ["b.ts"],
      // Different summary on purpose — merge semantics dedup by trimmed text.
      user_messages_summary: "Second-call summary body — should merge, not duplicate.",
      type: "guidelines",
      slug: "naming-pattern",
    }));

    // Identical triple → identical idempotency_key + pending_path.
    expect(second.idempotency_key).toBe(first.idempotency_key);
    expect(second.pending_path).toBe(first.pending_path);

    const body = await readFile(join(projectRoot, first.pending_path), "utf8");
    // Both notes appear (merge-evidence dedup semantics).
    expect(body).toMatch(/First-call summary body\./u);
    expect(body).toMatch(/Second-call summary body — should merge, not duplicate\./u);
    // v2.0.0-rc.7 T6: single `## Evidence` section, no `(call N)` sub-blocks.
    const evidenceHeadingMatches = body.match(/^## Evidence$/gmu) ?? [];
    expect(evidenceHeadingMatches.length).toBe(1);
    expect(body).not.toMatch(/^## Evidence \(call \d+\)$/mu);
    // Both paths merged.
    expect(body).toMatch(/^- a\.ts$/mu);
    expect(body).toMatch(/^- b\.ts$/mu);

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

  it("extractKnowledge_T6_merge_dedups_identical_notes_on_repeat_call", async () => {
    // v2.0.0-rc.7 T6 acceptance criterion: re-running extract twice with the
    // SAME notes MUST NOT produce duplicate `## Notes` / `## Evidence` blocks.
    // Prior behaviour appended a `## Evidence (call N)` section per call,
    // resulting in 3× duplicated bodies after 3 calls (the reported bug).
    const projectRoot = await createTempProject();
    const sharedNote = "Identical note body — must dedup on merge.";

    for (let i = 0; i < 3; i += 1) {
      await extractKnowledge(projectRoot, buildInput({
        source_session: "sess-dup",
        recent_paths: ["dup.ts"],
        user_messages_summary: sharedNote,
        type: "decisions",
        slug: "dedup-test",
      }));
    }

    const body = await readFile(
      join(projectRoot, ".fabric/knowledge/pending/decisions/dedup-test.md"),
      "utf8",
    );
    // Exactly ONE `## Evidence` section.
    const evidenceHeadings = body.match(/^## Evidence$/gmu) ?? [];
    expect(evidenceHeadings.length).toBe(1);
    // No legacy `## Evidence (call N)` blocks at all.
    expect(body).not.toMatch(/^## Evidence \(call \d+\)$/mu);
    // The note bullet appears exactly once under Notes (dedup by trimmed text);
    // it also surfaces in the `## Summary` section, so total occurrences in the
    // document is 2 (Summary copy + 1 deduped Notes bullet) — but NEVER 3+
    // duplicated Notes blocks the way the rc.6 append-on-collision behaved.
    const noteOccurrences = body.split(sharedNote).length - 1;
    expect(noteOccurrences).toBe(2);
    // The bulleted note line under Notes appears exactly once.
    const bulletOccurrences = (body.match(new RegExp(`^- ${sharedNote.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "gmu")) ?? []).length;
    expect(bulletOccurrences).toBe(1);
  });

  it("extractKnowledge_T6_merge_keeps_distinct_notes_from_multiple_calls", async () => {
    // v2.0.0-rc.7 T6: distinct notes across calls must all survive the merge,
    // each as its own bullet under `Notes:`.
    const projectRoot = await createTempProject();

    await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-distinct",
      recent_paths: ["one.ts"],
      user_messages_summary: "Observation A: discovered pattern X.",
      type: "models",
      slug: "merged-evidence",
    }));
    await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-distinct",
      recent_paths: ["two.ts"],
      user_messages_summary: "Observation B: pattern X interacts with Y.",
      type: "models",
      slug: "merged-evidence",
    }));
    await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-distinct",
      recent_paths: ["three.ts"],
      user_messages_summary: "Observation C: revised understanding after Z.",
      type: "models",
      slug: "merged-evidence",
    }));

    const body = await readFile(
      join(projectRoot, ".fabric/knowledge/pending/models/merged-evidence.md"),
      "utf8",
    );
    expect(body).toMatch(/Observation A: discovered pattern X\./u);
    expect(body).toMatch(/Observation B: pattern X interacts with Y\./u);
    expect(body).toMatch(/Observation C: revised understanding after Z\./u);
    // Single Evidence section regardless of call count.
    expect((body.match(/^## Evidence$/gmu) ?? []).length).toBe(1);
    // Three distinct recent_paths merged in.
    expect(body).toMatch(/^- one\.ts$/mu);
    expect(body).toMatch(/^- two\.ts$/mu);
    expect(body).toMatch(/^- three\.ts$/mu);
  });

  it("extractKnowledge_emits_archive_attempted_on_empty_summary", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-003",
      recent_paths: [],
      user_messages_summary: "   \n  \t  ",
      type: "pitfalls",
      slug: "empty-input",
    }));

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

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-004",
      recent_paths: ["x.ts"],
      user_messages_summary: "Some content.",
      type: "models",
      // Mix of upper-case, spaces, slashes, punctuation, accented chars.
      slug: "  Multi Word //  Slug!! With    Punctuation  ",
    }));

    expect(result.pending_path).toBe(
      ".fabric/knowledge/pending/models/multi-word-slug-with-punctuation.md",
    );
  });

  // ---- branch-coverage tests (rc.2 gate) ----

  it("extractKnowledge_handles_undefined_summary_via_nullish_coalesce", async () => {
    const projectRoot = await createTempProject();

    // user_messages_summary undefined exercises nullish-coalesce branch.
    const result = await extractKnowledge(projectRoot, {
      source_session: "sess-undef",
      recent_paths: [],
      // intentionally omit user_messages_summary
      type: "decisions",
      slug: "missing-summary",
      proposed_reason: "diagnostic-then-fix",
      session_context: "Session goal: cover nullish-coalesce. No real content.",
    } as unknown as Parameters<typeof extractKnowledge>[1]);

    // Empty summary path → no pending file written, archive_attempted emitted.
    expect(result.pending_path).toBe("");
    const archive = await readEventLedger(projectRoot, { event_type: "knowledge_archive_attempted" });
    expect(archive.events).toHaveLength(1);
  });

  it("extractKnowledge_treats_fully_punctuated_slug_as_empty", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-punct",
      recent_paths: [],
      user_messages_summary: "Some non-empty body.",
      type: "decisions",
      slug: "!!!@@@###",
    }));

    expect(result.pending_path).toBe("");
    const archive = await readEventLedger(projectRoot, { event_type: "knowledge_archive_attempted" });
    expect(archive.events).toHaveLength(1);
    // Reason falls back to input.slug when sanitizedSlug is empty.
    expect((archive.events[0] as KnowledgeArchiveAttemptedEvent | undefined)?.reason).toBe(
      "extract_knowledge:!!!@@@###",
    );
  });

  it("extractKnowledge_throws_on_collision_with_different_idempotency_key", async () => {
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
      extractKnowledge(projectRoot, buildInput({
        source_session: "sess-collision",
        recent_paths: [],
        user_messages_summary: "Fresh body must NOT win.",
        type: "decisions",
        slug: "collision",
      })),
    ).rejects.toThrow(/slug collision/u);

    // Stale file untouched (no data loss).
    const after = await readFile(target, "utf8");
    expect(after).toBe(stale);
  });

  it("extractKnowledge_renders_no_recent_paths_marker_when_recent_paths_empty", async () => {
    const projectRoot = await createTempProject();

    // recent_paths=[] exercises the empty-array branch in renderEvidenceBlock.
    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-empty-paths",
      recent_paths: [],
      user_messages_summary: "Body without recent paths.",
      type: "guidelines",
      slug: "no-paths",
    }));

    const body = await readFile(join(projectRoot, result.pending_path), "utf8");
    expect(body).toMatch(/_\(no recent paths reported\)_/u);
  });

  it("extractKnowledge_handles_existing_file_without_trailing_newline", async () => {
    const projectRoot = await createTempProject();

    // First write to establish an entry.
    const first = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-no-nl",
      recent_paths: ["a.ts"],
      user_messages_summary: "First body.",
      type: "guidelines",
      slug: "no-newline",
    }));

    // Mutate the file in-place to remove the trailing newline — exercises
    // the merge path with an existing file that lacks `\n` at EOF.
    const path = join(projectRoot, first.pending_path);
    const original = await readFile(path, "utf8");
    const stripped = original.replace(/\n+$/u, "");
    await writeFile(path, stripped, "utf8");

    const second = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-no-nl",
      recent_paths: ["b.ts"],
      user_messages_summary: "Second body, merged.",
      type: "guidelines",
      slug: "no-newline",
    }));
    expect(second.pending_path).toBe(first.pending_path);

    const body = await readFile(path, "utf8");
    // Both notes present, single Evidence section.
    expect(body).toMatch(/First body\./u);
    expect(body).toMatch(/Second body, merged\./u);
    expect((body.match(/^## Evidence$/gmu) ?? []).length).toBe(1);
  });

  it("extractKnowledge_throws_on_existing_file_without_frontmatter", async () => {
    const projectRoot = await createTempProject();
    const dir = join(projectRoot, ".fabric/knowledge/pending/decisions");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "no-frontmatter.md");
    const original = "Body without any frontmatter at all.\n";
    await writeFile(target, original, "utf8");

    await expect(
      extractKnowledge(projectRoot, buildInput({
        source_session: "sess-no-fm",
        recent_paths: [],
        user_messages_summary: "Replacement body.",
        type: "decisions",
        slug: "no-frontmatter",
      })),
    ).rejects.toThrow(/slug collision/u);

    const after = await readFile(target, "utf8");
    expect(after).toBe(original);
  });

  it("extractKnowledge_swallows_event_emission_failure_silently", async () => {
    const projectRoot = await createTempProject();

    const fabricDir = join(projectRoot, ".fabric");
    await mkdir(fabricDir, { recursive: true });
    await writeFile(join(fabricDir, "events.jsonl"), "", "utf8");
    try {
      await chmod(join(fabricDir, "events.jsonl"), 0o400);
    } catch {
      // some filesystems ignore chmod; skip the assertion below if so.
    }

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-evt-fail",
      recent_paths: ["a.ts"],
      user_messages_summary: "Body that succeeds writing the pending file.",
      type: "decisions",
      slug: "evt-fail",
    }));

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

    const longSlug = "a-very-long-slug-name-with-many-words-going-far-beyond-forty";
    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-long",
      recent_paths: [],
      user_messages_summary: "Body.",
      type: "decisions",
      slug: longSlug,
    }));

    const slugFromPath = result.pending_path
      .replace(".fabric/knowledge/pending/decisions/", "")
      .replace(/\.md$/, "");
    expect(slugFromPath.length).toBeLessThanOrEqual(40);
    expect(slugFromPath.length).toBeGreaterThan(0);
    expect(slugFromPath).not.toMatch(/-$/u);
  });

  it("extractKnowledge_throws_loudly_on_slug_collision_across_sessions", async () => {
    const projectRoot = await createTempProject();

    const first = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-A",
      recent_paths: ["a.ts"],
      user_messages_summary: "Original entry from session A.",
      type: "decisions",
      slug: "shared-slug",
    }));
    expect(first.pending_path).toBe(
      ".fabric/knowledge/pending/decisions/shared-slug.md",
    );
    const originalBody = await readFile(
      join(projectRoot, first.pending_path),
      "utf8",
    );

    await expect(
      extractKnowledge(projectRoot, buildInput({
        source_session: "sess-B",
        recent_paths: ["b.ts"],
        user_messages_summary: "Conflicting entry from session B.",
        type: "decisions",
        slug: "shared-slug",
      })),
    ).rejects.toThrow(/slug collision/u);

    const after = await readFile(
      join(projectRoot, first.pending_path),
      "utf8",
    );
    expect(after).toBe(originalBody);
    expect(after).toMatch(/Original entry from session A\./u);
    expect(after).not.toMatch(/Conflicting entry from session B\./u);

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

  // -------------------------------------------------------------------------
  // rc.5 TASK-008 (B1): dual pending root — team vs personal
  // -------------------------------------------------------------------------

  it("test_pending_base_team_repo", () => {
    const fakeProjectRoot = "/tmp/fake-project";
    const teamBase = pendingBase("team", fakeProjectRoot);
    expect(teamBase).toBe("/tmp/fake-project/.fabric/knowledge/pending");
  });

  it("test_pending_base_personal_homedir", () => {
    const fakeHome = process.env.FABRIC_HOME!;
    const fakeProjectRoot = "/tmp/fake-project";
    const personalBase = pendingBase("personal", fakeProjectRoot);
    expect(personalBase).toBe(join(fakeHome, ".fabric", "knowledge", "pending"));
    expect(personalBase).not.toContain(fakeProjectRoot);
  });

  it("extractKnowledge_routes_team_layer_write_to_workspace_pending", async () => {
    const projectRoot = await createTempProject();
    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-team",
      recent_paths: ["x.ts"],
      user_messages_summary: "Team-layer body.",
      type: "decisions",
      slug: "team-write",
      layer: "team",
    }));

    expect(result.pending_path).toBe(".fabric/knowledge/pending/decisions/team-write.md");
    const absoluteOnDisk = join(projectRoot, result.pending_path);
    expect(existsSync(absoluteOnDisk)).toBe(true);
    const body = await readFile(absoluteOnDisk, "utf8");
    expect(body).toMatch(/^layer: team$/mu);

    const fakeHome = process.env.FABRIC_HOME!;
    const personalPath = join(
      fakeHome,
      ".fabric",
      "knowledge",
      "pending",
      "decisions",
      "team-write.md",
    );
    expect(existsSync(personalPath)).toBe(false);
  });

  it("extractKnowledge_routes_personal_layer_write_to_home_pending", async () => {
    const projectRoot = await createTempProject();
    const fakeHome = process.env.FABRIC_HOME!;

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-personal",
      recent_paths: ["y.ts"],
      user_messages_summary: "Personal-layer body.",
      type: "guidelines",
      slug: "personal-write",
      layer: "personal",
    }));

    expect(result.pending_path).toBe("~/.fabric/knowledge/pending/guidelines/personal-write.md");

    const personalAbs = join(
      fakeHome,
      ".fabric",
      "knowledge",
      "pending",
      "guidelines",
      "personal-write.md",
    );
    expect(existsSync(personalAbs)).toBe(true);
    const body = await readFile(personalAbs, "utf8");
    expect(body).toMatch(/^layer: personal$/mu);

    const workspacePath = join(
      projectRoot,
      ".fabric",
      "knowledge",
      "pending",
      "guidelines",
      "personal-write.md",
    );
    expect(existsSync(workspacePath)).toBe(false);
  });

  it("extractKnowledge_defaults_layer_to_team_when_omitted", async () => {
    const projectRoot = await createTempProject();
    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-default",
      recent_paths: [],
      user_messages_summary: "Body without layer field.",
      type: "models",
      slug: "default-layer",
    }));
    expect(result.pending_path).toBe(".fabric/knowledge/pending/models/default-layer.md");
    expect(existsSync(join(projectRoot, result.pending_path))).toBe(true);

    const body = await readFile(join(projectRoot, result.pending_path), "utf8");
    expect(body).toMatch(/^layer: team$/mu);
  });

  // -------------------------------------------------------------------------
  // v2.0.0-rc.7 T5: source_sessions[] (array form + back-compat shim)
  // -------------------------------------------------------------------------

  it("extractKnowledge_T5_accepts_source_sessions_array_form", async () => {
    const projectRoot = await createTempProject();

    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: undefined,
      source_sessions: ["sess-a", "sess-b", "sess-c"],
      recent_paths: [],
      user_messages_summary: "Multi-session archive.",
      type: "decisions",
      slug: "multi-session",
    }));

    expect(result.pending_path).toBe(".fabric/knowledge/pending/decisions/multi-session.md");
    const body = await readFile(join(projectRoot, result.pending_path), "utf8");
    // Frontmatter renders the array form.
    expect(body).toMatch(/^source_sessions: \["sess-a", "sess-b", "sess-c"\]$/mu);
  });

  it("extractKnowledge_T5_back_compat_single_string_maps_to_array", async () => {
    const projectRoot = await createTempProject();

    // Legacy caller: passes single `source_session` string — must transparently
    // map to `source_sessions: ["sess-legacy"]` in the frontmatter.
    const result = await extractKnowledge(projectRoot, buildInput({
      source_session: "sess-legacy",
      recent_paths: [],
      user_messages_summary: "Legacy caller body.",
      type: "guidelines",
      slug: "legacy-shim",
    }));

    const body = await readFile(join(projectRoot, result.pending_path), "utf8");
    expect(body).toMatch(/^source_sessions: \["sess-legacy"\]$/mu);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-extract-knowledge-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
