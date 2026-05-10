/**
 * Integration: zod refine error message shape — shared.md §3 T4
 *
 * T4: All schemas that use .refine / .superRefine must produce ZodErrors with:
 *     - A human-readable `message` (not just "Invalid input")
 *     - A `path` that locates the problematic field
 *
 * Schemas with refine/superRefine: historyStateQuerySchema, ruleDescriptionSchema (strict),
 * forensicSamplingBudgetSchema (literal constraints), knowledgeTestIndexSchema (datetime),
 * forensicAssertionCoverageSchema (min/max).
 */
import { describe, expect, it } from 'vitest'

import { historyStateQuerySchema, annotateIntentRequestSchema } from '../../src/schemas/api-contracts.js'
import { ruleDescriptionSchema } from '../../src/schemas/agents-meta.js'
import { forensicReportSchema } from '../../src/schemas/forensic-report.js'
import { knowledgeTestIndexSchema } from '../../src/schemas/knowledge-test-index.js'
import { fabricConfigSchema } from '../../src/schemas/fabric-config.js'

// ---------------------------------------------------------------------------
// Helper: extract issues from a ZodError
// ---------------------------------------------------------------------------
function parseAndGetIssues(schema: { parse: (x: unknown) => unknown }, input: unknown) {
  try {
    schema.parse(input)
    return null
  } catch (e) {
    return (e as { issues?: Array<{ message: string; path: unknown[] }> }).issues ?? null
  }
}

// ---------------------------------------------------------------------------
// T4.1 — historyStateQuerySchema superRefine: custom message + path
// ---------------------------------------------------------------------------
describe('T4 historyStateQuerySchema superRefine error shape', () => {
  it('providing neither ledger_id nor ts: message is readable, path is present', () => {
    const issues = parseAndGetIssues(historyStateQuerySchema, {})
    expect(issues).not.toBeNull()
    expect(issues!.length).toBeGreaterThan(0)
    expect(issues![0]?.message).not.toBe('Invalid input')
    expect(issues![0]?.message).toContain('exactly one')
    expect(issues![0]?.path).toBeDefined()
    expect(Array.isArray(issues![0]?.path)).toBe(true)
  })

  it('providing both ledger_id and ts: message is readable, path is present', () => {
    const issues = parseAndGetIssues(historyStateQuerySchema, {
      ledger_id: 'ledger:abc',
      ts: 1_000_000,
    })
    expect(issues).not.toBeNull()
    expect(issues![0]?.message).toContain('exactly one')
    expect(issues![0]?.path).toBeDefined()
  })

  it('providing only ledger_id: succeeds (no error)', () => {
    expect(() => historyStateQuerySchema.parse({ ledger_id: 'ledger:abc' })).not.toThrow()
  })

  it('providing only ts: succeeds (no error)', () => {
    expect(() => historyStateQuerySchema.parse({ ts: 1_000_000 })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// T4.2 — ruleDescriptionSchema .strict(): unknown keys rejected with path
// ---------------------------------------------------------------------------
describe('T4 ruleDescriptionSchema strict mode error shape', () => {
  it('unknown key produces readable error with path', () => {
    const issues = parseAndGetIssues(ruleDescriptionSchema, {
      summary: 'Test',
      intent_clues: [],
      tech_stack: [],
      impact: [],
      must_read_if: 'always',
      unknownKey: 'should not be allowed',  // strict rejects this
    })
    expect(issues).not.toBeNull()
    expect(issues!.length).toBeGreaterThan(0)
    // Error should reference the unknown key
    const messages = issues!.map((i) => i.message).join(' ')
    expect(messages.length).toBeGreaterThan(0)
  })

  it('missing required summary field produces error with path', () => {
    const issues = parseAndGetIssues(ruleDescriptionSchema, {
      intent_clues: [],
      tech_stack: [],
      impact: [],
      must_read_if: 'always',
    })
    expect(issues).not.toBeNull()
    const paths = issues!.flatMap((i) => i.path)
    expect(paths).toContain('summary')
  })
})

// ---------------------------------------------------------------------------
// T4.3 — forensicSamplingBudgetSchema literal constraints
// ---------------------------------------------------------------------------
describe('T4 forensicSamplingBudgetSchema literal field error shape', () => {
  it('max_files != 15 produces error with path pointing to max_files', () => {
    const issues = parseAndGetIssues(forensicReportSchema, {
      version: '1.0',
      generated_at: '2026-05-08T00:00:00.000Z',
      generated_by: 'test',
      target: '/tmp',
      project_name: 'test',
      framework: { kind: 'vite', version: '5.0.0', subkind: 'vite-application', evidence: [] },
      topology: { total_files: 0, by_ext: {}, key_dirs: [], max_depth: 0 },
      entry_points: [],
      code_samples: [],
      assertions: [],
      candidate_files: [],
      sampling_budget: { max_files: 10, max_lines_per_file: 100 },  // max_files must be 15
      readme: { quality: 'missing', line_count: 0, has_contributing: false },
    })

    expect(issues).not.toBeNull()
    const paths = issues!.flatMap((i) => i.path.map(String))
    expect(paths.some((p) => p === 'sampling_budget' || p === 'max_files')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T4.4 — knowledgeTestIndexSchema: datetime format error
// ---------------------------------------------------------------------------
describe('T4 knowledgeTestIndexSchema datetime format error shape', () => {
  it('invalid datetime format in generated_at produces error with path', () => {
    const issues = parseAndGetIssues(knowledgeTestIndexSchema, {
      schema_version: 1,
      generated_at: 'not-a-datetime',  // must be ISO datetime with offset
      links: [],
      orphan_annotations: [],
    })

    expect(issues).not.toBeNull()
    const paths = issues!.flatMap((i) => i.path.map(String))
    expect(paths).toContain('generated_at')
    // Message should not be just "Invalid input"
    const messages = issues!.map((i) => i.message)
    expect(messages.every((m) => m !== 'Invalid input')).toBe(true)
  })

  it('valid datetime with offset succeeds', () => {
    expect(() =>
      knowledgeTestIndexSchema.parse({
        schema_version: 1,
        generated_at: '2026-05-08T00:00:00+08:00',
        links: [],
        orphan_annotations: [],
      }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// T4.5 — annotateIntentRequestSchema: annotation trim + min(1)
// ---------------------------------------------------------------------------
describe('T4 annotateIntentRequestSchema trim+min(1) error shape', () => {
  it('empty annotation after trim produces error with path', () => {
    const issues = parseAndGetIssues(annotateIntentRequestSchema, {
      ledger_entry_id: 'ledger:abc',
      annotation: '   ',  // trim → empty → fails min(1)
    })

    expect(issues).not.toBeNull()
    const paths = issues!.flatMap((i) => i.path.map(String))
    expect(paths).toContain('annotation')
  })

  it('missing ledger_entry_id produces error with path', () => {
    const issues = parseAndGetIssues(annotateIntentRequestSchema, {
      annotation: 'valid annotation',
    })

    expect(issues).not.toBeNull()
    const paths = issues!.flatMap((i) => i.path.map(String))
    expect(paths).toContain('ledger_entry_id')
  })
})

// ---------------------------------------------------------------------------
// T4.6 — Coverage ratio min/max validation (forensicAssertionCoverageSchema)
// ---------------------------------------------------------------------------
describe('T4 forensicAssertionCoverageSchema ratio bounds error shape', () => {
  it('ratio > 1 produces error with readable message and path', () => {
    const reportWithBadRatio = {
      version: '1.0',
      generated_at: '2026-05-08T00:00:00.000Z',
      generated_by: 'test',
      target: '/tmp',
      project_name: 'test',
      framework: { kind: 'vite', version: '5.0.0', subkind: 'vite-application', evidence: [] },
      topology: { total_files: 0, by_ext: {}, key_dirs: [], max_depth: 0 },
      entry_points: [],
      code_samples: [],
      assertions: [
        {
          type: 'pattern',
          statement: 'test',
          confidence: 'HIGH',
          evidence: [],
          coverage: {
            ratio: 1.5,  // > 1, invalid
            total: 2,
            matched: 2,
            co_occurring_patterns: [],
          },
        },
      ],
      candidate_files: [],
      sampling_budget: { max_files: 15 as const, max_lines_per_file: 100 as const },
      readme: { quality: 'missing' as const, line_count: 0, has_contributing: false },
    }

    const issues = parseAndGetIssues(forensicReportSchema, reportWithBadRatio)
    expect(issues).not.toBeNull()
    const paths = issues!.flatMap((i) => i.path.map(String))
    expect(paths.some((p) => p === 'ratio' || p === 'assertions' || p === 'coverage')).toBe(true)
  })

  it('ratio < 0 produces error with path', () => {
    const issues = parseAndGetIssues(forensicReportSchema, {
      version: '1.0',
      generated_at: '2026-05-08T00:00:00.000Z',
      generated_by: 'test',
      target: '/tmp',
      project_name: 'test',
      framework: { kind: 'vite', version: '5.0.0', subkind: 'vite-application', evidence: [] },
      topology: { total_files: 0, by_ext: {}, key_dirs: [], max_depth: 0 },
      entry_points: [],
      code_samples: [],
      assertions: [
        {
          type: 'pattern',
          statement: 'test',
          confidence: 'HIGH',
          evidence: [],
          coverage: { ratio: -0.5, total: 2, matched: 2, co_occurring_patterns: [] },
        },
      ],
      candidate_files: [],
      sampling_budget: { max_files: 15 as const, max_lines_per_file: 100 as const },
      readme: { quality: 'missing' as const, line_count: 0, has_contributing: false },
    })

    expect(issues).not.toBeNull()
  })
})
