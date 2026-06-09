/**
 * Integration: atomic-write — shared.md §2 I2, I3, §3 T5
 *
 * I2: rename failure → no .tmp residue, target file not partially written
 * I3: same (path, content) written twice → byte-identical final file
 * T5: EXDEV (cross-device rename) → error bubbles, .tmp cleaned, NO fallback copy
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { open, readFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted — wraps node:fs/promises so we can override `rename` per-test.
// All other exports pass through to the real implementation (writeFile, unlink, etc.).
// Tests override rename for EXDEV and observe open to guard the default fsync path.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
  }
})

import { atomicWriteText, atomicWriteJson } from '../../src/node/atomic-write.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// I2 — rename failure: no .tmp residue, target file not partially written
// ---------------------------------------------------------------------------
describe('I2 atomic-write: rename failure leaves no .tmp residue', () => {
  it('target is a directory — rename fails, .tmp cleaned', async () => {
    const dir = makeTempDir('aw-i2-dir-')
    const target = join(dir, 'output')

    // Create directory at target to cause rename failure (EISDIR)
    mkdirSync(target)

    await expect(atomicWriteText(target, 'content')).rejects.toThrow()

    const files = readdirSync(dir)
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
    // Directory itself still exists (rename failed before touching it)
    expect(files).toContain('output')
  })

  it('missing parent directory — write fails, no .tmp lingers', async () => {
    const dir = makeTempDir('aw-i2-nodir-')
    const target = join(dir, 'nonexistent', 'output.txt')

    await expect(atomicWriteText(target, 'data')).rejects.toThrow()

    const files = readdirSync(dir)
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('original file content preserved when rename fails after successful tmp write', async () => {
    const dir = makeTempDir('aw-i2-preserve-')
    const targetDir = join(dir, 'output')

    // Write original content first
    const target = join(dir, 'original.txt')
    await atomicWriteText(target, 'original content')

    // Now make a path that causes rename failure (target is a directory)
    mkdirSync(targetDir)
    await expect(atomicWriteText(targetDir, 'new content')).rejects.toThrow()

    // original.txt is untouched
    expect(readFileSync(target, 'utf8')).toBe('original content')
  })
})

// ---------------------------------------------------------------------------
// I3 — idempotent write
// ---------------------------------------------------------------------------
describe('I3 atomic-write: idempotent writes are byte-identical', () => {
  it('two writes of same ASCII content yield identical bytes', async () => {
    const dir = makeTempDir('aw-i3-ascii-')
    const target = join(dir, 'out.txt')
    const content = 'hello, world!\nline two\n'

    await atomicWriteText(target, content)
    const first = readFileSync(target, 'utf8')

    await atomicWriteText(target, content)
    const second = readFileSync(target, 'utf8')

    expect(first).toBe(content)
    expect(second).toBe(content)
    expect(second).toBe(first)
  })

  it('two writes of same UTF-8 multi-byte content yield identical bytes', async () => {
    const dir = makeTempDir('aw-i3-utf8-')
    const target = join(dir, 'out.txt')
    const content = '中文 – Chinese text with emoji: 😀\n'

    await atomicWriteText(target, content)
    const first = readFileSync(target)  // Buffer for byte-identical check

    await atomicWriteText(target, content)
    const second = readFileSync(target)

    expect(Buffer.compare(first, second)).toBe(0)  // byte-identical
  })

  it('two writes of empty content yield identical empty files', async () => {
    const dir = makeTempDir('aw-i3-empty-')
    const target = join(dir, 'out.txt')

    await atomicWriteText(target, '')
    const first = readFileSync(target, 'utf8')

    await atomicWriteText(target, '')
    const second = readFileSync(target, 'utf8')

    expect(first).toBe('')
    expect(second).toBe('')
  })
})

// ---------------------------------------------------------------------------
// T5 — EXDEV (cross-device rename): error bubbles, .tmp cleaned, no fallback
//
// We swap in a mocked `rename` (via vi.mock factory at top of file) that throws
// a real EXDEV error. The rest of fs/promises passes through. This actually
// exercises the EXDEV branch — guarding against any future fallback-copy logic.
// ---------------------------------------------------------------------------
describe('T5 atomic-write: EXDEV cross-device rename', () => {
  const renameMock = vi.mocked(rename)

  // The factory at file top initialized rename = vi.fn(actual.rename), so the
  // default impl already passes through. Per-test overrides via
  // mockImplementationOnce — never call mockReset (would wipe the pass-through).
  beforeEach(() => {
    renameMock.mockClear()
  })

  function exdevError(): NodeJS.ErrnoException {
    const err: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted')
    err.code = 'EXDEV'
    err.errno = -18
    err.syscall = 'rename'
    return err
  }

  it('EXDEV: error propagates with code preserved (no fallback copy)', async () => {
    const dir = makeTempDir('aw-t5-exdev-prop-')
    const target = join(dir, 'out.txt')

    renameMock.mockImplementationOnce(async () => {
      throw exdevError()
    })

    await expect(atomicWriteText(target, 'content')).rejects.toMatchObject({
      code: 'EXDEV',
    })
  })

  it('EXDEV: .tmp file cleaned up after rename throws', async () => {
    const dir = makeTempDir('aw-t5-exdev-cleanup-')
    const target = join(dir, 'out.txt')

    renameMock.mockImplementationOnce(async () => {
      throw exdevError()
    })

    await expect(atomicWriteText(target, 'content')).rejects.toThrow()

    // No .tmp residue — atomic-write must unlink on failure, not retry/copy
    const files = readdirSync(dir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })

  it('EXDEV: target file does NOT receive content (no fallback copy)', async () => {
    const dir = makeTempDir('aw-t5-exdev-nocopy-')
    const target = join(dir, 'out.txt')

    // Pre-existing file — must remain untouched
    await atomicWriteText(target, 'original')
    expect(readFileSync(target, 'utf8')).toBe('original')

    renameMock.mockImplementationOnce(async () => {
      throw exdevError()
    })

    await expect(atomicWriteText(target, 'replacement')).rejects.toThrow()

    // Critical assertion: no fallback copy means original survives intact
    expect(readFileSync(target, 'utf8')).toBe('original')

    const files = readdirSync(dir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })

  it('EXDEV via atomicWriteJson: same contract holds for JSON wrapper', async () => {
    const dir = makeTempDir('aw-t5-exdev-json-')
    const target = join(dir, 'data.json')

    renameMock.mockImplementationOnce(async () => {
      throw exdevError()
    })

    await expect(atomicWriteJson(target, { k: 'v' })).rejects.toMatchObject({
      code: 'EXDEV',
    })

    const files = readdirSync(dir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Durability default — fsync is opt-out, not opt-in
// ---------------------------------------------------------------------------
describe('atomic-write durability default', () => {
  const openMock = vi.mocked(open)

  beforeEach(() => {
    openMock.mockClear()
  })

  it('atomicWriteText defaults to the fd write path so datasync can run before rename', async () => {
    const dir = makeTempDir('aw-fsync-default-')
    const target = join(dir, 'out.txt')

    await atomicWriteText(target, 'durable by default')

    expect(openMock).toHaveBeenCalledOnce()
    expect(openMock.mock.calls[0]?.[1]).toBe('w')
    expect(readFileSync(target, 'utf8')).toBe('durable by default')
  })

  it('atomicWriteText allows explicit fsync opt-out for non-critical writes', async () => {
    const dir = makeTempDir('aw-fsync-optout-')
    const target = join(dir, 'out.txt')

    await atomicWriteText(target, 'fast path', { fsync: false })

    expect(openMock).not.toHaveBeenCalled()
    expect(readFileSync(target, 'utf8')).toBe('fast path')
  })
})

// ---------------------------------------------------------------------------
// Additional: atomicWriteJson integration
// ---------------------------------------------------------------------------
describe('atomic-write integration: atomicWriteJson', () => {
  it('JSON written is valid and deserializable', async () => {
    const dir = makeTempDir('aw-json-integ-')
    const target = join(dir, 'data.json')
    const data = { version: '1.0', items: [1, 2, 3], nested: { key: 'value' } }

    await atomicWriteJson(target, data)
    const content = await readFile(target, 'utf8')
    const parsed = JSON.parse(content)

    expect(parsed).toEqual(data)
  })

  it('JSON with indent=4 produces correct whitespace', async () => {
    const dir = makeTempDir('aw-json-indent-')
    const target = join(dir, 'data.json')

    await atomicWriteJson(target, { a: 1 }, { indent: 4 })
    const content = readFileSync(target, 'utf8')

    expect(content).toBe(JSON.stringify({ a: 1 }, null, 4) + '\n')
  })

  it('no .tmp file after successful JSON write', async () => {
    const dir = makeTempDir('aw-json-notmp-')
    const target = join(dir, 'data.json')

    await atomicWriteJson(target, { key: 'value' })

    const files = readdirSync(dir)
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })
})
