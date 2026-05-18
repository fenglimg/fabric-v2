import { appendFile, open, rename, unlink, writeFile } from "node:fs/promises";

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
