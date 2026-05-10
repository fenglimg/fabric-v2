import { describe, expect, it } from "vitest";

import { agentsMetaNodeSchema } from "../src/schemas/agents-meta";
import {
  KNOWLEDGE_TEST_INDEX_SCHEMA_VERSION,
  knowledgeTestIndexSchema,
  type KnowledgeTestIndex,
} from "../src/schemas/knowledge-test-index";

describe("knowledgeTestIndexSchema", () => {
  it("parses a V1 static traceability index with previous hashes and orphan annotations", () => {
    const parsed = knowledgeTestIndexSchema.parse({
      schema_version: KNOWLEDGE_TEST_INDEX_SCHEMA_VERSION,
      generated_at: "2026-04-26T00:00:00.000Z",
      revision: "rev-current",
      previous_revision: "rev-previous",
      links: [
        {
          rule_stable_id: "rules/shared-schema",
          rule_file: ".fabric/agents/packages/shared/AGENTS.md",
          rule_hash: "sha256:rule-current",
          previous_rule_hash: "sha256:rule-previous",
          test_file: "packages/shared/test/knowledge-test-index.test.ts",
          test_hash: "sha256:test-current",
          previous_test_hash: "sha256:test-previous",
          annotation_line: 12,
        },
      ],
      orphan_annotations: [
        {
          rule_stable_id: "rules/missing",
          test_file: "packages/shared/test/missing-rule.test.ts",
          test_hash: "sha256:orphan-test-current",
          previous_test_hash: "sha256:orphan-test-previous",
          annotation_line: 7,
        },
      ],
    });

    expect(parsed).toEqual<KnowledgeTestIndex>({
      schema_version: 1,
      generated_at: "2026-04-26T00:00:00.000Z",
      revision: "rev-current",
      previous_revision: "rev-previous",
      links: [
        {
          rule_stable_id: "rules/shared-schema",
          rule_file: ".fabric/agents/packages/shared/AGENTS.md",
          rule_hash: "sha256:rule-current",
          previous_rule_hash: "sha256:rule-previous",
          test_file: "packages/shared/test/knowledge-test-index.test.ts",
          test_hash: "sha256:test-current",
          previous_test_hash: "sha256:test-previous",
          annotation_line: 12,
        },
      ],
      orphan_annotations: [
        {
          rule_stable_id: "rules/missing",
          test_file: "packages/shared/test/missing-rule.test.ts",
          test_hash: "sha256:orphan-test-current",
          previous_test_hash: "sha256:orphan-test-previous",
          annotation_line: 7,
        },
      ],
    });
  });

  it("rejects malformed entries and non-V1 fields", () => {
    expect(() =>
      knowledgeTestIndexSchema.parse({
        schema_version: 1,
        generated_at: "2026-04-26T00:00:00.000Z",
        links: [
          {
            rule_stable_id: "rules/shared-schema",
            rule_file: ".fabric/agents/packages/shared/AGENTS.md",
            rule_hash: "sha256:rule-current",
            test_file: "packages/shared/test/knowledge-test-index.test.ts",
            test_hash: "sha256:test-current",
            annotation_line: 0,
          },
        ],
        orphan_annotations: [],
      }),
    ).toThrow();

    expect(() =>
      knowledgeTestIndexSchema.parse({
        schema_version: 1,
        generated_at: "2026-04-26T00:00:00.000Z",
        links: [],
        orphan_annotations: [],
        results: [],
      }),
    ).toThrow();
  });

  it("keeps agents.meta node shape unchanged", () => {
    const parsed = agentsMetaNodeSchema.parse({
      file: ".fabric/agents/packages/shared/AGENTS.md",
      scope_glob: "packages/shared/**",
      deps: [],
      priority: "medium",
      hash: "sha256:rule-current",
      test_file: "packages/shared/test/knowledge-test-index.test.ts",
    });

    expect(parsed).not.toHaveProperty("test_file");
    expect(parsed).not.toHaveProperty("test_hash");
    expect(parsed).not.toHaveProperty("previous_test_hash");
  });
});
