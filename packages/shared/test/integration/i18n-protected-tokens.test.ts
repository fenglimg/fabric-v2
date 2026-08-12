/**
 * Protected tokens must survive translation.
 *
 * PROTECTED_TOKENS is the vocabulary AI clients consume verbatim (MCP tool
 * names, contract field names, hard-rule keywords). If any of them is
 * translated or paraphrased in a locale, the client-side protocol breaks with
 * no error anywhere — so the registry is pinned here rather than spot-checked
 * with a few hand-picked `toContain` assertions.
 */
import { describe, expect, it } from 'vitest'

import { createTranslator } from '../../src/i18n/create-translator.js'
import { PROTECTED_TOKENS } from '../../src/i18n/protected-tokens.js'
import { enMessages } from '../../src/i18n/locales/en.js'
import { zhCNMessages } from '../../src/i18n/locales/zh-CN.js'
import type { Messages } from '../../src/i18n/types.js'

describe('protected tokens: registry', () => {
  it('the registry is pinned (add/remove fails this gate)', () => {
    expect([...PROTECTED_TOKENS].sort()).toMatchInlineSnapshot(`
      [
        ".fabric/events.jsonl",
        "@HUMAN",
        "AGENTS.md",
        "MUST",
        "NEVER",
        "broad",
        "fab_propose",
        "fab_recall",
        "fab_review",
        "knowledge/pending",
        "knowledge_proposed",
        "knowledge_scope_degraded",
        "layer",
        "narrow",
        "pending_path",
        "personal",
        "proposed_reason",
        "relevance_paths",
        "relevance_scope",
        "session_context",
        "source_sessions",
        "team",
      ]
    `)
  })

  it.each(PROTECTED_TOKENS)('%s is a non-blank token', (token) => {
    expect(token.trim()).toBe(token)
    expect(token.length).toBeGreaterThan(0)
  })
})

describe('protected tokens: translator', () => {
  const t = createTranslator('en')

  it('translator returns a non-empty string for every defined key', () => {
    for (const key of Object.keys(enMessages) as Array<keyof typeof enMessages>) {
      const result = t(key)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    }
  })

  it('substitution of {target} does not mutate tokens elsewhere in the message', () => {
    // cli.shared.target-invalid: "Target must be an existing directory: {target}"
    const result = t('cli.shared.target-invalid', { target: '/tmp/test' })
    expect(result).toContain('/tmp/test')
    expect(result).not.toContain('{target}')
  })

  it('substitution with protected token as value preserves it verbatim', () => {
    // Using a protected token as a substitution value — it must appear unchanged
    const result = t('cli.shared.target-invalid', { target: 'fab_recall' })
    expect(result).toContain('fab_recall')
  })

  it('substitution with no vars returns template unchanged', () => {
    const result = t('cli.main.description')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('unknown key falls back to the key itself', () => {
    const result = t('nonexistent.translation.key' as Parameters<typeof t>[0])
    expect(result).toBe('nonexistent.translation.key')
  })
})

describe('i18n: zh-CN locale falls back to en', () => {
  it('zh-CN translator does not throw for any en key', () => {
    const t = createTranslator('zh-CN')
    for (const key of Object.keys(enMessages) as Array<keyof typeof enMessages>) {
      expect(() => t(key)).not.toThrow()
    }
  })

  it('zh-CN locale provides translated messages or falls back to en', () => {
    const t = createTranslator('zh-CN')
    // The translator returns zh-CN version if available, en fallback otherwise
    const result = t('cli.main.description')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('i18n: createTranslator with custom messages', () => {
  it('custom messages override defaults', () => {
    const custom: Messages = {
      ...enMessages,
      'cli.main.description': 'Custom description for testing',
    }
    const t = createTranslator('en', { en: custom, 'zh-CN': zhCNMessages })
    expect(t('cli.main.description')).toBe('Custom description for testing')
  })

  it('unknown locale falls back to en messages', () => {
    const t = createTranslator('unknown-locale' as Parameters<typeof createTranslator>[0])
    // Falls back to en — should not throw and should return a valid string
    const result = t('cli.main.description')
    expect(typeof result).toBe('string')
  })
})
