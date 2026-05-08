/**
 * Integration: forensic-report large fileTree — shared.md §3 T1
 *
 * T1: forensicReportSchema with large arrays (many assertions, code_samples,
 *     candidate_files) — parses correctly, maintains order, does NOT truncate.
 *     Refine errors (if any) carry field path for locatability.
 */
import { describe, expect, it } from 'vitest'

import { forensicReportSchema } from '../../src/schemas/forensic-report.js'

// ---------------------------------------------------------------------------
// Helpers to build large-scale report fixtures
// ---------------------------------------------------------------------------
function makeAssertion(i: number) {
  return {
    type: 'pattern' as const,
    statement: `Pattern assertion #${i}: files follow consistent naming convention.`,
    confidence: 'MEDIUM' as const,
    evidence: [
      { file: `src/module-${i}/index.ts`, line: '1', snippet: `export const feature${i} = true;` },
    ],
    coverage: {
      ratio: 0.8,
      total: 10,
      matched: 8,
      co_occurring_patterns: [`pattern-${i}`, `related-${i}`],
    },
    proposed_rule: `Enforce naming convention for module-${i}.`,
    alternatives: [`Alternative approach ${i}`],
  }
}

function makeCodeSample(i: number) {
  return {
    path: `src/module-${i}/component.ts`,
    lines: `${i * 10 + 1}-${i * 10 + 10}`,
    snippet: `// Module ${i} snippet\nexport class Component${i} {}`,
    pattern_hint: `component-pattern-${i}`,
  }
}

function makeCandidateFile(i: number) {
  return {
    path: `src/module-${i}/index.ts`,
    family: 'component' as const,
    rationale: `Module ${i} matches the component file pattern with high frequency.`,
  }
}

const BASE_REPORT = {
  version: '1.0',
  generated_at: '2026-05-08T00:00:00.000Z',
  generated_by: 'fab-cli@integration-test',
  target: '/tmp/large-project',
  project_name: 'large-project',
  framework: {
    kind: 'vite',
    version: '5.0.0',
    subkind: 'vite-application',
    evidence: ['package.json dependency: vite@5.0.0'],
  },
  topology: {
    total_files: 500,
    by_ext: { '.ts': 300, '.tsx': 100, '.json': 50, '.md': 50 },
    key_dirs: ['src', 'tests', 'scripts'],
    max_depth: 6,
  },
  entry_points: Array.from({ length: 15 }, (_, i) => ({
    path: `src/entry-${i}/index.ts`,
    reason: `Entry point ${i}`,
    size_bytes: 1024 + i * 512,
  })),
  sampling_budget: { max_files: 15 as const, max_lines_per_file: 100 as const },
  readme: { quality: 'ok' as const, line_count: 120, has_contributing: true },
}

// ---------------------------------------------------------------------------
// T1.1 — Large assertions array: parse succeeds and order is preserved
// ---------------------------------------------------------------------------
describe('T1 forensic-report large assertions array', () => {
  it('parses 100 assertions and preserves order', () => {
    const assertions = Array.from({ length: 100 }, (_, i) => makeAssertion(i))
    const report = {
      ...BASE_REPORT,
      assertions,
      code_samples: [],
      candidate_files: [],
    }

    const parsed = forensicReportSchema.parse(report)

    expect(parsed.assertions).toHaveLength(100)
    // Order preserved — first and last are correct
    expect(parsed.assertions[0]?.statement).toContain('Pattern assertion #0')
    expect(parsed.assertions[99]?.statement).toContain('Pattern assertion #99')

    // No truncation — all 100 items present
    for (let i = 0; i < 100; i++) {
      expect(parsed.assertions[i]?.coverage.matched).toBe(8)
    }
  })

  it('round-trip of large assertions array is stable', () => {
    const assertions = Array.from({ length: 50 }, (_, i) => makeAssertion(i))
    const report = {
      ...BASE_REPORT,
      assertions,
      code_samples: [],
      candidate_files: [],
    }

    const a = forensicReportSchema.parse(report)
    const b = forensicReportSchema.parse(JSON.parse(JSON.stringify(a)))

    expect(b.assertions).toHaveLength(50)
    for (let i = 0; i < 50; i++) {
      expect(b.assertions[i]).toStrictEqual(a.assertions[i])
    }
  })
})

// ---------------------------------------------------------------------------
// T1.2 — Large code_samples: parse succeeds and order preserved
// ---------------------------------------------------------------------------
describe('T1 forensic-report large code_samples array', () => {
  it('parses 15 code samples (sampling budget limit)', () => {
    const report = {
      ...BASE_REPORT,
      assertions: [],
      code_samples: Array.from({ length: 15 }, (_, i) => makeCodeSample(i)),
      candidate_files: [],
    }

    const parsed = forensicReportSchema.parse(report)
    expect(parsed.code_samples).toHaveLength(15)
    expect(parsed.code_samples[0]?.path).toBe('src/module-0/component.ts')
    expect(parsed.code_samples[14]?.path).toBe('src/module-14/component.ts')
  })
})

// ---------------------------------------------------------------------------
// T1.3 — Large candidate_files: parse succeeds and order preserved
// ---------------------------------------------------------------------------
describe('T1 forensic-report large candidate_files array', () => {
  it('parses large candidate_files array and preserves order', () => {
    const report = {
      ...BASE_REPORT,
      assertions: [],
      code_samples: [],
      candidate_files: Array.from({ length: 100 }, (_, i) => makeCandidateFile(i)),
    }

    const parsed = forensicReportSchema.parse(report)
    expect(parsed.candidate_files).toHaveLength(100)
    expect(parsed.candidate_files[0]?.path).toBe('src/module-0/index.ts')
    expect(parsed.candidate_files[99]?.path).toBe('src/module-99/index.ts')
  })
})

// ---------------------------------------------------------------------------
// T1.4 — Large recommendations_for_skill array
// ---------------------------------------------------------------------------
describe('T1 forensic-report large recommendations_for_skill', () => {
  it('parses large recommendations array (deprecated field still works)', () => {
    const recommendations = Array.from(
      { length: 50 },
      (_, i) => `Recommendation ${i}: consider refactoring module-${i} for better maintainability.`,
    )

    const report = {
      ...BASE_REPORT,
      assertions: [],
      code_samples: [],
      candidate_files: [],
      recommendations_for_skill: recommendations,
    }

    const parsed = forensicReportSchema.parse(report)
    expect(parsed.recommendations_for_skill).toHaveLength(50)
    expect(parsed.recommendations_for_skill?.[0]).toContain('Recommendation 0')
  })
})

// ---------------------------------------------------------------------------
// T1.5 — All-large combined: parse does not truncate or throw
// ---------------------------------------------------------------------------
describe('T1 forensic-report combined large arrays', () => {
  it('combined large assertions + code_samples + candidate_files parses without truncation', () => {
    const report = {
      ...BASE_REPORT,
      assertions: Array.from({ length: 50 }, (_, i) => makeAssertion(i)),
      code_samples: Array.from({ length: 15 }, (_, i) => makeCodeSample(i)),
      candidate_files: Array.from({ length: 50 }, (_, i) => makeCandidateFile(i)),
    }

    const parsed = forensicReportSchema.parse(report)

    expect(parsed.assertions).toHaveLength(50)
    expect(parsed.code_samples).toHaveLength(15)
    expect(parsed.candidate_files).toHaveLength(50)
  })
})

// ---------------------------------------------------------------------------
// T1.6 — Invalid assertion rejected with locatable error path
// ---------------------------------------------------------------------------
describe('T1 forensic-report zod refine error shape (T4 overlap)', () => {
  it('invalid confidence value produces structured ZodError with path', () => {
    const report = {
      ...BASE_REPORT,
      assertions: [
        {
          type: 'pattern',
          statement: 'Test assertion',
          confidence: 'VERY_HIGH',  // invalid — not in enum
          evidence: [],
          coverage: { ratio: 0.5, total: 2, matched: 1, co_occurring_patterns: [] },
        },
      ],
      code_samples: [],
      candidate_files: [],
    }

    let zodError: unknown
    try {
      forensicReportSchema.parse(report)
    } catch (e) {
      zodError = e
    }

    expect(zodError).toBeDefined()
    // ZodError should have issues with a path pointing to assertions[0].confidence
    const issues = (zodError as { issues?: Array<{ path: unknown[] }> }).issues
    expect(issues).toBeDefined()
    expect(issues!.length).toBeGreaterThan(0)
    // Path should reference the assertions array
    expect(issues![0]?.path).toBeDefined()
  })
})
