import { appendFile, mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicWriteOptions {
  fsync?: boolean;
}

export interface AtomicWriteJsonOptions extends AtomicWriteOptions {
  indent?: number;
}

function makeTmpSuffix(): string {
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `.${process.pid}.${Date.now()}.${rand}.tmp`;
}

export async function atomicWriteText(
  path: string,
  content: string,
  opts?: AtomicWriteOptions,
): Promise<void> {
  const tmpPath = path + makeTmpSuffix();

  try {
    if (opts?.fsync) {
      const fd = await open(tmpPath, "w");
      try {
        await fd.writeFile(content, "utf8");
        await fd.datasync();
      } finally {
        await fd.close();
      }
    } else {
      await writeFile(tmpPath, content, "utf8");
    }
    await rename(tmpPath, path);
  } catch (err) {
    // best-effort cleanup — tmp may not exist if writeFile itself failed
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
  opts?: AtomicWriteJsonOptions,
): Promise<void> {
  const indent = opts?.indent ?? 2;
  const content = JSON.stringify(value, null, indent) + "\n";
  await atomicWriteText(path, content, { fsync: opts?.fsync });
}

export interface FileLockOptions {
  /** A held lock older than this (ms, by lock-file mtime) is presumed stale —
   * left by a crashed holder — and reclaimed. Default 10s. */
  staleMs?: number;
  /** Poll interval (ms) between acquire attempts while contended. Default 20ms. */
  retryDelayMs?: number;
  /** Give up acquiring after this long (ms) and throw. Default 10s. */
  maxWaitMs?: number;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` while holding a cross-process advisory lock at `lockPath`.
 *
 * Unlike the hook-side `appendLockedLine` (which DROPS on contention, fine for
 * best-effort telemetry), this WAITS for the lock — the critical section it
 * guards (e.g. a read-modify-write of a shared counter file) must not be
 * skipped. The lock is a `wx` (O_CREAT|O_EXCL) lock file, so acquisition is
 * atomic across processes; a crashed holder leaves the file behind, so any
 * holder older than `staleMs` is reclaimed. The lock is always released in a
 * `finally`, even if `fn` throws.
 *
 * Scope: cross-process AND in-process. Two concurrent callers on the same
 * `lockPath` (same process or not) serialize, because both race the same
 * O_EXCL create.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? 10_000;
  const retryDelayMs = opts.retryDelayMs ?? 20;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  await mkdir(dirname(lockPath), { recursive: true });

  const start = Date.now();
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, "wx"); // atomic create-exclusive = acquire
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
      // Contended: reclaim a stale holder, otherwise wait and retry.
      try {
        const st = await stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          await unlink(lockPath).catch(() => undefined);
          continue; // reclaimed — retry immediately
        }
      } catch {
        continue; // lock vanished between EEXIST and stat — retry immediately
      }
      if (Date.now() - start > maxWaitMs) {
        throw new Error(`withFileLock: timed out acquiring ${lockPath} after ${maxWaitMs}ms`);
      }
      await sleep(retryDelayMs);
      continue;
    }
    // Acquired.
    try {
      await handle.close();
      return await fn();
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export interface LedgerWriteQueue {
  append(path: string, line: string): Promise<void>;
  /**
   * Run `fn` with exclusive access to `path` against all other queue operations
   * (other `runExclusive` calls and `append` calls) on the same path within
   * this LedgerWriteQueue instance.
   *
   * Scope: per-path, in-process (same Node process, same queue instance).
   * Does NOT provide cross-process locking — separate concern.
   *
   * Error semantics: a rejection from `fn` is propagated to the returned
   * Promise but does NOT poison the chain — subsequent `runExclusive` /
   * `append` calls on the same path will still acquire and run.
   *
   * Ordering: submission-order FIFO. Calls on different paths run independently
   * (in parallel where possible).
   */
  runExclusive<T>(path: string, fn: () => Promise<T>): Promise<T>;
}

export function createLedgerWriteQueue(): LedgerWriteQueue {
  const chains = new Map<string, Promise<void>>();

  async function doAppend(path: string, line: string): Promise<void> {
    const normalized = line.endsWith("\n") ? line : line + "\n";
    await appendFile(path, normalized, "utf8");
  }

  function enqueue<T>(path: string, work: () => Promise<T>): Promise<T> {
    const prev = chains.get(path) ?? Promise.resolve();
    // Caller-facing promise: resolves/rejects with `work`'s result.
    const result = prev.catch(() => undefined).then(() => work());
    // Chain-internal promise: never rejects, so a failing `work` doesn't
    // poison subsequent operations on this path.
    const chainSlot = result.then(
      () => undefined,
      () => undefined,
    );
    chains.set(path, chainSlot);
    // When this slot settles, remove it from the map if it is still the
    // latest entry for this path.
    chainSlot.finally(() => {
      if (chains.get(path) === chainSlot) {
        chains.delete(path);
      }
    });
    return result;
  }

  return {
    append(path: string, line: string): Promise<void> {
      return enqueue(path, () => doAppend(path, line));
    },
    runExclusive<T>(path: string, fn: () => Promise<T>): Promise<T> {
      return enqueue(path, fn);
    },
  };
}
