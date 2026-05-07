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
}

export function createLedgerWriteQueue(): LedgerWriteQueue {
  const chains = new Map<string, Promise<void>>();

  async function doAppend(path: string, line: string): Promise<void> {
    const normalized = line.endsWith("\n") ? line : line + "\n";
    await appendFile(path, normalized, "utf8");
  }

  return {
    append(path: string, line: string): Promise<void> {
      const prev = chains.get(path) ?? Promise.resolve();
      const next = prev.catch(() => undefined).then(() => doAppend(path, line));
      chains.set(path, next);
      return next;
    },
  };
}
