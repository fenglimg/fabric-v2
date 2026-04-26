import { z } from "zod";

export const RULE_TEST_INDEX_SCHEMA_VERSION = 1;

const hashSchema = z.string().min(1);

export const ruleTestLinkSchema = z
  .object({
    rule_stable_id: z.string().min(1),
    rule_file: z.string().min(1),
    rule_hash: hashSchema,
    previous_rule_hash: hashSchema.optional(),
    test_file: z.string().min(1),
    test_hash: hashSchema,
    previous_test_hash: hashSchema.optional(),
    annotation_line: z.number().int().positive(),
  })
  .strict();

export const ruleTestOrphanAnnotationSchema = z
  .object({
    rule_stable_id: z.string().min(1),
    test_file: z.string().min(1),
    test_hash: hashSchema,
    previous_test_hash: hashSchema.optional(),
    annotation_line: z.number().int().positive(),
  })
  .strict();

export const ruleTestIndexSchema = z
  .object({
    schema_version: z.literal(RULE_TEST_INDEX_SCHEMA_VERSION),
    generated_at: z.string().datetime({ offset: true }),
    revision: z.string().min(1).optional(),
    previous_revision: z.string().min(1).optional(),
    links: z.array(ruleTestLinkSchema),
    orphan_annotations: z.array(ruleTestOrphanAnnotationSchema),
  })
  .strict();

export type RuleTestLink = z.infer<typeof ruleTestLinkSchema>;
export type RuleTestOrphanAnnotation = z.infer<typeof ruleTestOrphanAnnotationSchema>;
export type RuleTestIndex = z.infer<typeof ruleTestIndexSchema>;
