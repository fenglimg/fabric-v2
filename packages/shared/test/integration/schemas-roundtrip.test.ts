/**
 * Integration: zod schema round-trip — shared.md §2 I1
 *
 * I1: For any valid input x, parse(JSON.parse(JSON.stringify(parse(x)))) deep-equals parse(x).
 *
 * Covers all 11 zod schemas listed in §1:
 *   agents-meta, api-contracts, event-ledger, events, fabric-config,
 *   forensic-report, human-lock, init-context, ledger-entry, knowledge-test-index
 *   (structuredWarningSchema is in api-contracts — counts as the 11th)
 */
import { test, fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'

import { agentsMetaNodeSchema, agentsMetaSchema, ruleDescriptionSchema } from '../../src/schemas/agents-meta.js'
import {
  structuredWarningSchema,
  ledgerQuerySchema,
  annotateIntentRequestSchema,
  humanLockApproveRequestSchema,
  humanLockFileParamsSchema,
} from '../../src/schemas/api-contracts.js'
import { eventLedgerEventSchema } from '../../src/schemas/event-ledger.js'
import { fabricEventSchema } from '../../src/schemas/events.js'
import { fabricConfigSchema } from '../../src/schemas/fabric-config.js'
import { forensicReportSchema } from '../../src/schemas/forensic-report.js'
import { humanLockEntrySchema, humanLockFileSchema } from '../../src/schemas/human-lock.js'
import { initContextSchema } from '../../src/schemas/init-context.js'
import { aiLedgerEntrySchema, humanLedgerEntrySchema, ledgerEntrySchema } from '../../src/schemas/ledger-entry.js'
import { knowledgeTestIndexSchema, knowledgeTestLinkSchema } from '../../src/schemas/knowledge-test-index.js'

// ---------------------------------------------------------------------------
// Helper: round-trip assertion
// ---------------------------------------------------------------------------
function roundTrip<T>(schema: { parse: (x: unknown) => T }, input: unknown): void {
  const a = schema.parse(input)
  const b = schema.parse(JSON.parse(JSON.stringify(a)))
  expect(b).toStrictEqual(a)
}

// ---------------------------------------------------------------------------
// I1.1 — fabricConfigSchema
// ---------------------------------------------------------------------------
describe('I1.1 fabricConfigSchema round-trip', () => {
  it('minimal empty config', () => {
    roundTrip(fabricConfigSchema, {})
  })
  it('full config with all fields', () => {
    roundTrip(fabricConfigSchema, {
      clientPaths: { claudeCodeCLI: '/usr/bin/claude', cursor: '/usr/bin/cursor' },
      externalFixturePath: '/fixtures',
      scanIgnores: ['node_modules', 'dist'],
      auditMode: 'strict',
      mcpPayloadLimits: { warnBytes: 8192, hardBytes: 32768 },
    })
  })
  it('clientPathsSchema rejects unknown clientPaths keys (strict, no passthrough)', () => {
    // v2.0 / rc.2: Fabric scope is locked to claudeCodeCLI / claudeCodeDesktop /
    // cursor / codexCLI. Retired v1.x keys (windsurf, rooCode, geminiCLI) and
    // any other unknown key fail at Zod parse time on the strict
    // clientPathsSchema — there is no soft-deprecation path.
    for (const retired of ['windsurf', 'rooCode', 'geminiCLI', 'unknownClient']) {
      expect(() =>
        fabricConfigSchema.parse({
          clientPaths: { claudeCodeCLI: '/usr/bin/claude', [retired]: '/tmp/example' },
        }),
      ).toThrow()
    }
  })
})

// ---------------------------------------------------------------------------
// I1.2 — humanLockEntrySchema + humanLockFileSchema
// ---------------------------------------------------------------------------
describe('I1.2 humanLock schemas round-trip', () => {
  const entry = { file: 'src/foo.ts', start_line: 1, end_line: 10, hash: 'sha256:abc' }
  it('humanLockEntrySchema', () => roundTrip(humanLockEntrySchema, entry))
  it('humanLockFileSchema empty', () => roundTrip(humanLockFileSchema, {}))
  it('humanLockFileSchema with entries', () => roundTrip(humanLockFileSchema, { locked: [entry] }))
})

// ---------------------------------------------------------------------------
// I1.3 — ledgerEntrySchema (discriminated union + preprocess)
// ---------------------------------------------------------------------------
describe('I1.3 ledgerEntrySchema round-trip', () => {
  it('ai ledger entry', () => {
    roundTrip(aiLedgerEntrySchema, {
      ts: 1_000_000,
      intent: 'add feature X',
      affected_paths: ['src/app.ts'],
      source: 'ai',
      commit_sha: 'abc123',
    })
  })
  it('human ledger entry', () => {
    roundTrip(humanLedgerEntrySchema, {
      ts: 2_000_000,
      intent: 'review pass',
      affected_paths: ['src/app.ts'],
      source: 'human',
      parent_sha: 'def456',
      diff_stat: '5 files, +20 -3',
    })
  })
  it('ledgerEntrySchema auto-injects source=human when missing', () => {
    const result = ledgerEntrySchema.parse({
      ts: 3_000_000,
      intent: 'legacy entry without source',
      affected_paths: ['src/index.ts'],
      parent_sha: 'ghi789',
      diff_stat: '1 file',
    })
    expect(result.source).toBe('human')
  })
})

// ---------------------------------------------------------------------------
// I1.4 — knowledgeTestIndexSchema
// ---------------------------------------------------------------------------
describe('I1.4 knowledgeTestIndexSchema round-trip', () => {
  const link = {
    rule_stable_id: 'bootstrap',
    rule_file: '.fabric/knowledge/decisions/root.md',
    rule_hash: 'sha256:rule1',
    test_file: 'test/bootstrap.test.ts',
    test_hash: 'sha256:test1',
    annotation_line: 3,
  }
  it('minimal index', () => {
    roundTrip(knowledgeTestIndexSchema, {
      schema_version: 1,
      generated_at: '2026-05-08T00:00:00+08:00',
      revision: 'rev-abc',
      links: [link],
      orphan_annotations: [],
    })
  })
  it('knowledgeTestLinkSchema with optional previous hashes', () => {
    roundTrip(knowledgeTestLinkSchema, {
      ...link,
      previous_rule_hash: 'sha256:old-rule',
      previous_test_hash: 'sha256:old-test',
    })
  })
})

// ---------------------------------------------------------------------------
// I1.5 — initContextSchema round-trip
// ---------------------------------------------------------------------------
describe('I1.5 initContextSchema round-trip', () => {
  it('minimal init context', () => {
    roundTrip(initContextSchema, {
      framework: { kind: 'vite', version: '5.0.0', subkind: 'vite-application' },
      architecture_patterns: ['spa'],
      invariants: [],
      domain_groups: [],
      interview_trail: [],
      forensic_ref: '.fabric/forensic.json',
    })
  })
  it('full init context with all optional fields', () => {
    roundTrip(initContextSchema, {
      framework: { kind: 'next', version: '14.0.0', subkind: 'next-application' },
      architecture_patterns: ['ssr', 'api-routes'],
      invariants: [
        {
          type: 'require',
          rule: 'Use server components by default.',
          rationale: 'Performance',
          confidence_snapshot: { confidence: 'HIGH', evidence_refs: ['src/app/page.tsx:1'] },
          source_evidence: [{ file: 'src/app/page.tsx', lines: '1-5' }],
        },
      ],
      domain_groups: [
        {
          name: 'ui',
          paths: ['src/components'],
          summary: 'React components',
          topology_type: 'mirror',
          target_path: '.fabric/agents/src/components/AGENTS.md',
        },
      ],
      interview_trail: [
        {
          phase: 'Phase 1',
          question: 'What patterns?',
          answer: 'SSR',
          presentation: 'summary',
          user_corrections: ['Use app router'],
        },
      ],
      forensic_ref: '.fabric/forensic.json',
    })
  })
})

// ---------------------------------------------------------------------------
// I1.6 — forensicReportSchema round-trip
// ---------------------------------------------------------------------------
const baseForensicReport = {
  version: '1.0',
  generated_at: '2026-05-08T00:00:00.000Z',
  generated_by: 'fab-cli@test',
  target: '/tmp/test-project',
  project_name: 'test-project',
  framework: { kind: 'vite', version: '5.0.0', subkind: 'vite-application', evidence: [] },
  topology: { total_files: 5, by_ext: { '.ts': 5 }, key_dirs: ['src'], max_depth: 2 },
  entry_points: [],
  code_samples: [],
  assertions: [],
  candidate_files: [],
  sampling_budget: { max_files: 15 as const, max_lines_per_file: 100 as const },
  readme: { quality: 'ok' as const, line_count: 50, has_contributing: true },
}

describe('I1.6 forensicReportSchema round-trip', () => {
  it('minimal report', () => roundTrip(forensicReportSchema, baseForensicReport))
  it('report with full assertion', () => {
    roundTrip(forensicReportSchema, {
      ...baseForensicReport,
      assertions: [
        {
          type: 'invariant',
          statement: 'Must use TypeScript strict mode.',
          confidence: 'HIGH',
          evidence: [{ file: 'tsconfig.json', line: '5', snippet: '"strict": true' }],
          coverage: { ratio: 1.0, total: 1, matched: 1, co_occurring_patterns: [] },
          proposed_rule: 'Enforce strict TypeScript.',
          alternatives: [],
        },
      ],
    })
  })
})

// ---------------------------------------------------------------------------
// I1.7 — structuredWarningSchema (api-contracts)
// ---------------------------------------------------------------------------
describe('I1.7 structuredWarningSchema round-trip', () => {
  it('with optional line field', () => {
    roundTrip(structuredWarningSchema, {
      code: 'missing_description',
      file: 'src/foo.ts',
      line: 42,
      action_hint: 'Add description metadata.',
    })
  })
  it('without optional line field', () => {
    roundTrip(structuredWarningSchema, {
      code: 'config_stale',
      file: '.fabric/agents.meta.json',
      action_hint: 'Run fab sync-meta.',
    })
  })
})

// ---------------------------------------------------------------------------
// I1.8 — eventLedgerEventSchema (key discriminators)
// ---------------------------------------------------------------------------
describe('I1.8 eventLedgerEventSchema round-trip', () => {
  const envelope = {
    kind: 'fabric-event' as const,
    id: 'evt:1',
    ts: 1000,
    schema_version: 1 as const,
  }

  it('knowledge_context_planned event', () => {
    roundTrip(eventLedgerEventSchema, {
      ...envelope,
      event_type: 'knowledge_context_planned',
      target_paths: ['src/app.ts'],
      required_stable_ids: ['bootstrap'],
      ai_selectable_stable_ids: [],
      final_stable_ids: ['bootstrap'],
    })
  })

  it('knowledge_selection event', () => {
    roundTrip(eventLedgerEventSchema, {
      ...envelope,
      event_type: 'knowledge_selection',
      selection_token: 'selection:rev:abc',
      target_paths: ['src/app.ts'],
      required_stable_ids: ['bootstrap'],
      ai_selectable_stable_ids: ['ui-rules'],
      ai_selected_stable_ids: ['ui-rules'],
      final_stable_ids: ['bootstrap', 'ui-rules'],
      ai_selection_reasons: { 'ui-rules': 'Touches UI.' },
      rejected_stable_ids: [],
      ignored_stable_ids: [],
    })
  })

  it('knowledge_drift_detected event', () => {
    roundTrip(eventLedgerEventSchema, {
      ...envelope,
      event_type: 'knowledge_drift_detected',
      drifted_stable_ids: ['ui-rules'],
      missing_files: [],
      stale_files: ['src/app.ts'],
    })
  })

  it('meta_reconciled event', () => {
    roundTrip(eventLedgerEventSchema, {
      ...envelope,
      event_type: 'meta_reconciled',
      reconciled_files: ['.fabric/knowledge/decisions/root.md'],
      duration_ms: 50,
      trigger: 'doctor',
      source: 'reconcileRules',
    })
  })

  it('tags field roundtrip on ruleDescriptionSchema', () => {
    // v2/rc.2: tags is a flat flow-style YAML array in frontmatter; schema
    // stores it as string[]. Verify default=[] and explicit values survive
    // JSON parse/stringify.
    roundTrip(ruleDescriptionSchema, {
      summary: 'Track the primary tech stack.',
      intent_clues: ['typescript', 'react'],
      tech_stack: ['typescript'],
      impact: ['all files'],
      must_read_if: 'touching tech stack',
      tags: ['typescript', 'react', 'vite'],
    })
    roundTrip(ruleDescriptionSchema, {
      summary: 'No tags field — default [] applies.',
      intent_clues: [],
      tech_stack: [],
      impact: [],
      must_read_if: 'always',
    })
  })
})

// ---------------------------------------------------------------------------
// I1.9 — fabricEventSchema (events.ts discriminated union)
// ---------------------------------------------------------------------------
describe('I1.9 fabricEventSchema round-trip', () => {
  it('meta:updated event', () => {
    roundTrip(fabricEventSchema, {
      type: 'meta:updated',
      payload: {
        revision: 'rev-1',
        nodes: {
          bootstrap: {
            file: 'AGENTS.md',
            scope_glob: '**/*',
            deps: [],
            priority: 'high',
            hash: 'sha256:abc',
          },
        },
      },
    })
  })

  it('ledger:appended event', () => {
    roundTrip(fabricEventSchema, {
      type: 'ledger:appended',
      payload: {
        ts: 1000,
        intent: 'update UI',
        affected_paths: ['src/App.tsx'],
        source: 'ai',
      },
    })
  })
})

// ---------------------------------------------------------------------------
// I1.10 — agentsMetaSchema round-trip
// ---------------------------------------------------------------------------
describe('I1.10 agentsMetaSchema round-trip', () => {
  it('single node meta', () => {
    roundTrip(agentsMetaSchema, {
      revision: 'rev-abc',
      nodes: {
        bootstrap: {
          file: 'AGENTS.md',
          scope_glob: '**/*',
          deps: [],
          priority: 'high',
          hash: 'sha256:bootstrap',
        },
      },
    })
  })
})

// ---------------------------------------------------------------------------
// I1.11 — ledgerQuerySchema + annotateIntentRequestSchema (api-contracts)
// ---------------------------------------------------------------------------
describe('I1.11 remaining api-contracts schemas round-trip', () => {
  it('ledgerQuerySchema', () => {
    roundTrip(ledgerQuerySchema, { source: 'ai' })
    roundTrip(ledgerQuerySchema, {})
  })
  it('humanLockApproveRequestSchema', () => {
    roundTrip(humanLockApproveRequestSchema, {
      file: 'src/app.ts',
      start_line: 10,
      end_line: 20,
      new_hash: 'sha256:new',
    })
  })
  it('humanLockFileParamsSchema', () => {
    roundTrip(humanLockFileParamsSchema, { file: 'src/app.ts' })
  })
  it('annotateIntentRequestSchema', () => {
    roundTrip(annotateIntentRequestSchema, {
      ledger_entry_id: 'ledger:abc',
      annotation: 'Reviewed and approved.',
    })
  })
})

// ---------------------------------------------------------------------------
// Property-based I1 for humanLockEntrySchema
// ---------------------------------------------------------------------------
describe('I1 property-based: humanLockEntrySchema', () => {
  test.prop([
    fc.record({
      file: fc.string({ minLength: 1 }),
      start_line: fc.integer({ min: 0, max: 100000 }),
      end_line: fc.integer({ min: 0, max: 100000 }),
      hash: fc.string({ minLength: 1 }),
    }),
  ])('humanLockEntrySchema round-trip', (input) => {
    const a = humanLockEntrySchema.parse(input)
    const b = humanLockEntrySchema.parse(JSON.parse(JSON.stringify(a)))
    expect(b).toStrictEqual(a)
  })
})
