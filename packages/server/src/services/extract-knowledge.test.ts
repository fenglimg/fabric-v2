import { mkdtemp, readFile, rm } from "node:fs/promises";
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
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-extract-knowledge-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
