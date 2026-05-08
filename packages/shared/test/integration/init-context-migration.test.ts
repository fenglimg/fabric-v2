/**
 * Integration: init-context migration — shared.md §3 T2
 *
 * T2: 1.7 → 1.8 field changes; schema handles unknown client keys per
 *     strict/passthrough policy; no data loss for known fields.
 */
import { describe, expect, it } from 'vitest'

import { initContextSchema } from '../../src/schemas/init-context.js'

// ---------------------------------------------------------------------------
// T2.1 — Legacy 1.7 shape without optional fields parses correctly
// ---------------------------------------------------------------------------
describe('T2 init-context migration: legacy 1.7 shape', () => {
  it('minimal 1.7 shape (no optional fields) parses correctly', () => {
    const legacy = {
      framework: { kind: 'cocos-creator', version: '3.7.0', subkind: 'typescript-component' },
      architecture_patterns: ['scene-based'],
      invariants: [
        { type: 'require', rule: 'Require @ccclass on component scripts.' },
      ],
      domain_groups: [
        { name: 'gameplay', paths: ['assets/scripts/gameplay'] },
      ],
      interview_trail: [
        { phase: 'Phase 1', question: 'Primary framework?', answer: 'Cocos Creator 3.x' },
      ],
      forensic_ref: '.fabric/forensic.json',
    }

    const parsed = initContextSchema.parse(legacy)

    expect(parsed.framework.kind).toBe('cocos-creator')
    expect(parsed.framework.version).toBe('3.7.0')
    expect(parsed.invariants[0]?.type).toBe('require')
    // Optional fields absent
    expect(parsed.invariants[0]?.rationale).toBeUndefined()
    expect(parsed.invariants[0]?.confidence_snapshot).toBeUndefined()
    expect(parsed.domain_groups[0]?.topology_type).toBeUndefined()
    expect(parsed.domain_groups[0]?.target_path).toBeUndefined()
    expect(parsed.interview_trail[0]?.presentation).toBeUndefined()
    expect(parsed.interview_trail[0]?.user_corrections).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// T2.2 — 1.8 shape with all new optional fields parses correctly
// ---------------------------------------------------------------------------
describe('T2 init-context migration: 1.8 shape with all optional fields', () => {
  it('full 1.8 shape parses correctly', () => {
    const v18 = {
      framework: { kind: 'next', version: '14.0.0', subkind: 'next-application' },
      architecture_patterns: ['ssr', 'api-routes', 'component-library'],
      invariants: [
        {
          type: 'ban',
          rule: 'Ban getServerSideProps in favor of server components.',
          rationale: 'App router uses server components by default.',
          confidence_snapshot: {
            confidence: 'HIGH',
            evidence_refs: ['src/app/page.tsx:1-5', 'src/app/layout.tsx:3'],
          },
          source_evidence: [
            { file: 'src/app/page.tsx', lines: '1-5' },
          ],
        },
        {
          type: 'require',
          rule: "Require 'use client' directive in interactive components.",
          rationale: 'App Router requires explicit client marking.',
          confidence_snapshot: {
            confidence: 'MEDIUM',
            evidence_refs: ['src/components/Button.tsx:1'],
          },
        },
      ],
      domain_groups: [
        {
          name: 'ui',
          paths: ['src/components'],
          summary: 'React UI components',
          topology_type: 'mirror',
          target_path: '.fabric/agents/src/components/AGENTS.md',
        },
        {
          name: 'api',
          paths: ['src/app/api', 'src/lib'],
          topology_type: 'cross-cutting',
          target_path: '.fabric/agents/_cross/api.md',
        },
      ],
      interview_trail: [
        {
          phase: 'Architecture Review',
          question: 'What should the agent know about this Next.js setup?',
          answer: 'Use App Router and server components exclusively.',
          presentation: 'Presented framework, invariants, and domain groups.',
          user_corrections: [
            'API routes should remain in app/api, not pages/api.',
          ],
        },
      ],
      forensic_ref: '.fabric/forensic.json',
    }

    const parsed = initContextSchema.parse(v18)

    expect(parsed.invariants).toHaveLength(2)
    expect(parsed.invariants[0]?.confidence_snapshot?.confidence).toBe('HIGH')
    expect(parsed.invariants[1]?.confidence_snapshot?.confidence).toBe('MEDIUM')
    expect(parsed.domain_groups[0]?.topology_type).toBe('mirror')
    expect(parsed.domain_groups[1]?.topology_type).toBe('cross-cutting')
    expect(parsed.interview_trail[0]?.user_corrections).toContain(
      'API routes should remain in app/api, not pages/api.',
    )
  })
})

// ---------------------------------------------------------------------------
// T2.3 — Round-trip: 1.8 shape survives JSON serialization
// ---------------------------------------------------------------------------
describe('T2 init-context round-trip', () => {
  it('1.8 init-context round-trips through JSON', () => {
    const input = {
      framework: { kind: 'vite', version: '5.0.0', subkind: 'vite-application' },
      architecture_patterns: ['spa', 'state-management'],
      invariants: [
        {
          type: 'protect',
          rule: 'Protect shared utility functions from direct mutation.',
          rationale: 'Immutability for shared state.',
          confidence_snapshot: { confidence: 'LOW', evidence_refs: ['src/utils/index.ts:1'] },
          source_evidence: [{ file: 'src/utils/index.ts', lines: '1-10' }],
        },
      ],
      domain_groups: [
        {
          name: 'stores',
          paths: ['src/stores'],
          summary: 'State management stores',
          topology_type: 'cross-cutting' as const,
          target_path: '.fabric/agents/_cross/stores.md',
        },
      ],
      interview_trail: [
        {
          phase: 'Phase 2',
          question: 'How is state shared?',
          answer: 'Via Pinia stores.',
          presentation: 'Showed topology and store patterns.',
          user_corrections: [],
        },
      ],
      forensic_ref: '.fabric/forensic.json',
    }

    const a = initContextSchema.parse(input)
    const b = initContextSchema.parse(JSON.parse(JSON.stringify(a)))

    expect(b).toStrictEqual(a)
    expect(b.invariants[0]?.confidence_snapshot?.evidence_refs).toEqual(['src/utils/index.ts:1'])
    expect(b.domain_groups[0]?.topology_type).toBe('cross-cutting')
  })
})

// ---------------------------------------------------------------------------
// T2.4 — Invalid invariant type rejected with structured error
// ---------------------------------------------------------------------------
describe('T2 init-context migration: invalid values', () => {
  it('invalid invariant type produces ZodError with path', () => {
    const input = {
      framework: { kind: 'react', version: '18.0.0', subkind: 'react-application' },
      architecture_patterns: [],
      invariants: [
        { type: 'unknown-type', rule: 'some rule' },  // invalid
      ],
      domain_groups: [],
      interview_trail: [],
      forensic_ref: '.fabric/forensic.json',
    }

    let zodError: unknown
    try {
      initContextSchema.parse(input)
    } catch (e) {
      zodError = e
    }

    expect(zodError).toBeDefined()
    const issues = (zodError as { issues?: Array<{ path: unknown[] }> }).issues
    expect(issues).toBeDefined()
    expect(issues!.some((i) => i.path.some((p) => p === 'type' || p === 0 || p === 'invariants'))).toBe(true)
  })

  it('missing required field (forensic_ref) produces ZodError', () => {
    let zodError: unknown
    try {
      initContextSchema.parse({
        framework: { kind: 'react', version: '18.0.0', subkind: 'react-application' },
        architecture_patterns: [],
        invariants: [],
        domain_groups: [],
        interview_trail: [],
        // forensic_ref missing
      })
    } catch (e) {
      zodError = e
    }

    expect(zodError).toBeDefined()
  })
})
