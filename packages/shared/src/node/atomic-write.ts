import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

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
  const shouldFsync = opts?.fsync ?? true;

  try {
    if (shouldFsync) {
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

  // Unique ownership token written into the lock file. Release/reclaim only ever
  // removes a lock whose on-disk token still matches the token it observed — so a
  // holder that overran `staleMs` (and was reclaimed) can never delete the NEW
  // holder's lock. Without this, the old `finally`/reclaim did an unconditional
  // unlink(lockPath), letting two callers enter the critical section at once.
  const token = `${process.pid}.${randomUUID()}`;

  const start = Date.now();
  // Last contention error seen, so a timeout can name the real cause instead of
  // reporting a bare "timed out" for what may have been a genuine EPERM.
  let lastContentionError: NodeJS.ErrnoException | null = null;
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, "wx"); // atomic create-exclusive = acquire
    } catch (err) {
      if (!isErrnoException(err)) throw err;
      // POSIX signals contention as EEXIST. Windows does not: unlinking a file
      // that another process still has open only marks it DELETE-PENDING, and
      // opening a delete-pending file returns EPERM (ERROR_ACCESS_DENIED), or
      // EBUSY. Under N concurrent holders that release-and-reacquire in a loop,
      // that window is hit routinely — so on win32 these two codes mean exactly
      // what EEXIST means everywhere else: someone else holds it, wait.
      //
      // They are NOT treated as contention off win32: there EPERM really is a
      // permission problem and must surface immediately rather than spin until
      // maxWaitMs. A genuine win32 permission error still terminates — it just
      // does so via the timeout below, which carries this error as its cause.
      const contended =
        err.code === "EEXIST" ||
        (process.platform === "win32" && (err.code === "EPERM" || err.code === "EBUSY"));
      if (!contended) throw err;
      lastContentionError = err;
      // Contended: reclaim a stale holder, otherwise wait and retry.
      //
      // ⚠️ Every path out of this block MUST fall through to the deadline check
      // below. Two of them used to `continue` straight past it, so whenever the
      // failing-open/absent-lock combination persisted — exactly what win32
      // DELETE-PENDING produces (open fails, stat then reports ENOENT) — the
      // loop spun hot forever: no timeout, no sleep, no yield. maxWaitMs is the
      // only thing bounding this function; a `continue` that skips it silently
      // turns a lock contention into a hang.
      let reclaimed = false;
      try {
        const st = await stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          // Read the stale holder's token, then unlink only if it is unchanged —
          // guards against deleting a lock that was recreated between stat and unlink.
          const staleToken = await readFile(lockPath, "utf8").catch(() => null);
          if (staleToken !== null) {
            await unlinkIfToken(lockPath, staleToken);
          }
          reclaimed = true; // (or lost the race) — retry the wx create either way
        }
      } catch {
        // Lock vanished between the failed open and stat. Retry, but still via
        // the deadline check + backoff: the open may keep failing for a reason
        // that stat cannot see.
      }
      if (Date.now() - start > maxWaitMs) {
        throw new Error(
          `withFileLock: timed out acquiring ${lockPath} after ${maxWaitMs}ms` +
            (lastContentionError ? ` (last error: ${lastContentionError.code})` : ""),
          { cause: lastContentionError ?? undefined },
        );
      }
      // A successful reclaim means the lock should now be free — retry at once.
      if (!reclaimed) await sleep(retryDelayMs);
      continue;
    }
    // Acquired — stamp our ownership token into the lock file before running fn.
    try {
      await handle.writeFile(token, "utf8");
      await handle.close();
      return await fn();
    } finally {
      await unlinkIfToken(lockPath, token); // only remove the lock if we still own it
    }
  }
}

/**
 * Unlink `lockPath` only if its current contents equal `expected`. Best-effort:
 * a mismatch (another holder reclaimed and rewrote it) or a vanished file both
 * leave the unlink as a no-op. Not perfectly atomic across processes — there is
 * no portable compare-and-unlink syscall — but it closes the lock-theft window
 * that an unconditional unlink left wide open.
 */
async function unlinkIfToken(lockPath: string, expected: string): Promise<void> {
  try {
    const current = await readFile(lockPath, "utf8");
    if (current === expected) {
      await unlink(lockPath).catch(() => undefined);
    }
  } catch {
    // file already gone / unreadable — nothing to release
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
