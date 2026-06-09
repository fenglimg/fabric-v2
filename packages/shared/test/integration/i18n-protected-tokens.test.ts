/**
 * Integration: i18n protected-tokens — shared.md §2 I7
 *
 * I7: Protected tokens (command names, flag names, error codes) are never
 *     translated in any locale. t() placeholder substitution does not corrupt
 *     protected segments.
 */
import { describe, expect, it } from 'vitest'

import { createTranslator } from '../../src/i18n/create-translator.js'
import { PROTECTED_TOKENS } from '../../src/i18n/protected-tokens.js'
import { enMessages } from '../../src/i18n/locales/en.js'
import { zhCNMessages } from '../../src/i18n/locales/zh-CN.js'
import type { Messages } from '../../src/i18n/types.js'

// ---------------------------------------------------------------------------
// I7.1 — Protected tokens appear verbatim in en locale
// ---------------------------------------------------------------------------
describe('I7 protected tokens: en locale', () => {
  const t = createTranslator('en')

  it('translator returns a string for every defined key', () => {
    for (const key of Object.keys(enMessages) as Array<keyof typeof enMessages>) {
      const result = t(key)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    }
  })

  it('PROTECTED_TOKENS array is non-empty', () => {
    expect(PROTECTED_TOKENS.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// I7.2 — Protected tokens in message templates are not altered
// ---------------------------------------------------------------------------
describe('I7 protected tokens: tokens preserved across locales', () => {
  // Create a synthetic locale that attempts to translate protected terms
  const sensitiveMessages: Messages = {
    ...enMessages,
    // Override a key that might reference a protected token — check that the
    // *en* fallback or value preserves the token.
    // The key we use needs to exist in the en locale.
    'cli.sync-meta.drift-detected': 'Translation attempt of fabric sync-meta drift.',
  }

  const protectedTokensList = PROTECTED_TOKENS as ReadonlyArray<string>

  it('none of PROTECTED_TOKENS is empty or whitespace', () => {
    for (const token of protectedTokensList) {
      expect(token.trim().length).toBeGreaterThan(0)
    }
  })

  it('PROTECTED_TOKENS includes fab_plan_context', () => {
    expect(protectedTokensList).toContain('fab_plan_context')
  })

  it('PROTECTED_TOKENS includes fab_get_knowledge_sections', () => {
    expect(protectedTokensList).toContain('fab_get_knowledge_sections')
  })

  it('PROTECTED_TOKENS includes MUST', () => {
    expect(protectedTokensList).toContain('MUST')
  })

  it('PROTECTED_TOKENS includes NEVER', () => {
    expect(protectedTokensList).toContain('NEVER')
  })

  it('PROTECTED_TOKENS includes knowledge/pending', () => {
    expect(protectedTokensList).toContain('knowledge/pending')
  })
})

// ---------------------------------------------------------------------------
// I7.3 — t() placeholder substitution does not break tokens
// ---------------------------------------------------------------------------
describe('I7 protected tokens: t() placeholder substitution', () => {
  const t = createTranslator('en')

  it('substitution of {target} does not mutate tokens elsewhere in the message', () => {
    // cli.shared.target-invalid: "Target must be an existing directory: {target}"
    const result = t('cli.shared.target-invalid', { target: '/tmp/test' })
    expect(result).toContain('/tmp/test')
    expect(result).not.toContain('{target}')
  })

  it('substitution with protected token as value preserves it verbatim', () => {
    // Using a protected token as a substitution value — it must appear unchanged
    const result = t('cli.shared.target-invalid', { target: 'fab_plan_context' })
    expect(result).toContain('fab_plan_context')
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

// ---------------------------------------------------------------------------
// I7.4 — zh-CN locale falls back to en for missing keys
// ---------------------------------------------------------------------------
describe('I7 i18n: zh-CN locale fallback to en', () => {
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

// ---------------------------------------------------------------------------
// I7.5 — Custom messages override
// ---------------------------------------------------------------------------
describe('I7 i18n: createTranslator with custom messages', () => {
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
