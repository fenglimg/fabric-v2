/**
 * Integration: detectFramework — shared.md §2 I8
 *
 * I8: detectFramework returns `unknown` for non-existent / empty / unrecognized dirs;
 *     never throws; return shape is stable (kind/version/subkind/evidence/framework/confidence).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { detectFramework } from '../../src/detector.js'
import type { FrameworkInfo } from '../../src/detector.js'

const tempRoots: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// I8.1 — Non-existent directory returns unknown
// ---------------------------------------------------------------------------
describe('I8 detectFramework: non-existent directory', () => {
  it('returns unknown kind for a non-existent path (no throw)', () => {
    const result = detectFramework('/nonexistent/path/that/does/not/exist')
    expect(() => detectFramework('/nonexistent/path')).not.toThrow()
    expect(result.kind).toBe('unknown')
    expect(result.framework).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// I8.2 — Empty directory returns unknown
// ---------------------------------------------------------------------------
describe('I8 detectFramework: empty directory', () => {
  it('returns unknown for completely empty directory', () => {
    const dir = makeTempDir('detect-empty-')
    const result = detectFramework(dir)

    expect(result.kind).toBe('unknown')
    expect(result.framework).toBe('unknown')
    expect(result.version).toBe('unknown')
    expect(result.subkind).toBe('unknown')
  })

  it('does not throw for empty directory', () => {
    const dir = makeTempDir('detect-nothrow-')
    expect(() => detectFramework(dir)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// I8.3 — Unrecognized files only returns unknown
// ---------------------------------------------------------------------------
describe('I8 detectFramework: directory with irrelevant files', () => {
  it('returns unknown for directory with only .txt and .md files', () => {
    const dir = makeTempDir('detect-irrelevant-')
    writeFileSync(join(dir, 'README.md'), '# Project', 'utf8')
    writeFileSync(join(dir, 'notes.txt'), 'some notes', 'utf8')

    const result = detectFramework(dir)
    expect(result.kind).toBe('unknown')
  })

  it('returns unknown for directory with only a Makefile', () => {
    const dir = makeTempDir('detect-makefile-')
    writeFileSync(join(dir, 'Makefile'), 'all:\n\techo hello', 'utf8')

    const result = detectFramework(dir)
    expect(result.kind).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// I8.4 — Return shape is stable (all fields present)
// ---------------------------------------------------------------------------
describe('I8 detectFramework: return shape stability', () => {
  const requiredFields: Array<keyof FrameworkInfo> = [
    'kind', 'version', 'subkind', 'evidence', 'framework', 'confidence',
    'ast_evidence', 'co_packages',
  ]

  it('unknown result has all required shape fields', () => {
    const dir = makeTempDir('detect-shape-')
    const result = detectFramework(dir)

    for (const field of requiredFields) {
      expect(result).toHaveProperty(field)
    }
    expect(Array.isArray(result.evidence)).toBe(true)
    expect(Array.isArray(result.ast_evidence)).toBe(true)
    expect(Array.isArray(result.co_packages)).toBe(true)
  })

  it('known framework result has all required shape fields', () => {
    const dir = makeTempDir('detect-next-shape-')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0', 'react-dom': '18.0.0' } }, null, 2),
      'utf8',
    )

    const result = detectFramework(dir)

    for (const field of requiredFields) {
      expect(result).toHaveProperty(field)
    }
  })

  it('unknown result: confidence is LOW', () => {
    const dir = makeTempDir('detect-confidence-')
    const result = detectFramework(dir)
    expect(result.confidence).toBe('LOW')
  })
})

// ---------------------------------------------------------------------------
// I8.5 — Positive framework detection tests (completeness)
// ---------------------------------------------------------------------------
describe('I8 detectFramework: positive detections', () => {
  it('detects Next.js', () => {
    const dir = makeTempDir('detect-next-')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.0.0' } }),
      'utf8',
    )
    const result = detectFramework(dir)
    expect(result.kind).toBe('next')
  })

  it('detects Vite', () => {
    const dir = makeTempDir('detect-vite-')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }),
      'utf8',
    )
    const result = detectFramework(dir)
    expect(result.kind).toBe('vite')
  })

  it('detects React', () => {
    const dir = makeTempDir('detect-react-')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'utf8',
    )
    const result = detectFramework(dir)
    expect(result.kind).toBe('react')
  })

  it('detects Rust (Cargo.toml)', () => {
    const dir = makeTempDir('detect-rust-')
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "test"', 'utf8')
    const result = detectFramework(dir)
    expect(result.kind).toBe('rust')
    expect(result.confidence).toBe('HIGH')
  })

  it('detects Python (pyproject.toml)', () => {
    const dir = makeTempDir('detect-python-')
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "test"', 'utf8')
    const result = detectFramework(dir)
    expect(result.kind).toBe('python')
    expect(result.confidence).toBe('HIGH')
  })

  it('detects Cocos Creator from project.config.json', () => {
    const dir = makeTempDir('detect-cocos-')
    writeFileSync(
      join(dir, 'project.config.json'),
      JSON.stringify({ creator: { version: '3.8.0' } }),
      'utf8',
    )
    const result = detectFramework(dir)
    expect(result.kind).toBe('cocos-creator')
    expect(result.confidence).toBe('HIGH')
  })
})

// ---------------------------------------------------------------------------
// I8.6 — Package.json with malformed JSON: falls back to unknown
// ---------------------------------------------------------------------------
describe('I8 detectFramework: malformed package.json graceful handling', () => {
  it('malformed package.json does not throw — returns unknown', () => {
    const dir = makeTempDir('detect-malformed-')
    writeFileSync(join(dir, 'package.json'), '{ not valid json }', 'utf8')

    expect(() => detectFramework(dir)).not.toThrow()
    const result = detectFramework(dir)
    expect(result.kind).toBe('unknown')
  })
})
