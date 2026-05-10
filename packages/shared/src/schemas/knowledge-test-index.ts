import { z } from "zod";

export const KNOWLEDGE_TEST_INDEX_SCHEMA_VERSION = 1;

const hashSchema = z.string().min(1);

export const knowledgeTestLinkSchema = z
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

export const knowledgeTestOrphanAnnotationSchema = z
  .object({
    rule_stable_id: z.string().min(1),
    test_file: z.string().min(1),
    test_hash: hashSchema,
    previous_test_hash: hashSchema.optional(),
    annotation_line: z.number().int().positive(),
  })
  .strict();

export const knowledgeTestIndexSchema = z
  .object({
    schema_version: z.literal(KNOWLEDGE_TEST_INDEX_SCHEMA_VERSION),
    generated_at: z.string().datetime({ offset: true }),
    revision: z.string().min(1).optional(),
    previous_revision: z.string().min(1).optional(),
    links: z.array(knowledgeTestLinkSchema),
    orphan_annotations: z.array(knowledgeTestOrphanAnnotationSchema),
  })
  .strict();

export type KnowledgeTestLink = z.infer<typeof knowledgeTestLinkSchema>;
export type KnowledgeTestOrphanAnnotation = z.infer<typeof knowledgeTestOrphanAnnotationSchema>;
export type KnowledgeTestIndex = z.infer<typeof knowledgeTestIndexSchema>;
