import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { STORE_LAYOUT, type StoreIdentity, storeIdentitySchema } from "../schemas/store.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P1 — Store disk reader.
//
// A directory is a v2.1 store IFF it contains a `store.json` parsing to
// storeIdentitySchema (S42/A2). This is the single recognition rule, and it is
// what makes the clean-slate boundary hold (S22/S66): a v2.0-style in-repo
// `.fabric/knowledge/` directory has NO store.json, so `recognizeStoreDir`
// returns false — the new reader never picks up legacy layouts and no
// auto-migration is attempted (KT-DEC-0002).
// ---------------------------------------------------------------------------

// Read + validate a store's identity file, or null when the directory is not a
// recognizable store (missing / unreadable / schema-invalid store.json).
export function readStoreIdentity(absDir: string): StoreIdentity | null {
  const identityFile = join(absDir, STORE_LAYOUT.identityFile);
  if (!existsSync(identityFile)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(identityFile, "utf8"));
  } catch {
    return null;
  }
  const parsed = storeIdentitySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Async twin for request-time store operations. Missing/unreadable/schema-invalid
// stores degrade to null, matching the synchronous reader contract.
export async function readStoreIdentityAsync(absDir: string): Promise<StoreIdentity | null> {
  const identityFile = join(absDir, STORE_LAYOUT.identityFile);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(identityFile, "utf8"));
  } catch {
    return null;
  }
  const parsed = storeIdentitySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// True when `absDir` is a recognizable v2.1 store root.
export function recognizeStoreDir(absDir: string): boolean {
  return readStoreIdentity(absDir) !== null;
}

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P4 — S65 RCE defense: a store is DATA-ONLY.
//
// A mounted store ships knowledge (markdown/JSON) and nothing else. Hooks come
// exclusively from the CLI install pipeline — NEVER projected from a store —
// otherwise a shared store could ship executable code that runs on every
// collaborator's machine (supply-chain RCE). This guard scans a store tree for
// any executable surface (exec-bit file or hook/script extension) so the mount
// path can refuse to trust a store that smuggles one in. A clean knowledge
// store yields [] (`.git` internals are excluded — they are git's, not the
// store's content, and are never executed by Fabric).
// ---------------------------------------------------------------------------

const SCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".mjs",
  ".js",
  ".ts",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".pl",
]);

function hasScriptExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && SCRIPT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

// ISS-028: bound the synchronous walk so a pathologically deep / huge store
// cannot block the event loop indefinitely at mount/verify time. The bounds are
// generous — a legitimate data-only KB (markdown/JSON in a handful of dirs)
// never approaches them. Crucially the bound is FAIL-CLOSED: when it is hit we
// record a synthetic violation and stop, so an over-large/over-deep store is
// flagged (and refused trust) rather than partially-scanned-and-trusted — an
// attacker cannot bury an executable past the bound to evade the S65 guard.
const STORE_SCAN_MAX_DEPTH = 32;
const STORE_SCAN_MAX_ENTRIES = 100_000;

export type FindStoreExecutableViolationsOptions = {
  maxDepth?: number;
  maxEntries?: number;
};

// Returns relative paths (POSIX) of any executable/script file found inside the
// store tree — the S65 violation set. Empty ⟺ the store is data-only. A
// `<scan-bounded: …>` synthetic entry means the tree exceeded the scan bounds
// (fail-closed — treat as untrusted).
export function findStoreExecutableViolations(
  absDir: string,
  options: FindStoreExecutableViolationsOptions = {},
): string[] {
  const maxDepth = options.maxDepth ?? STORE_SCAN_MAX_DEPTH;
  const maxEntries = options.maxEntries ?? STORE_SCAN_MAX_ENTRIES;
  const violations: string[] = [];
  let entriesScanned = 0;
  let bounded = false;

  const walk = (dir: string, rel: string, depth: number): void => {
    if (bounded) {
      return;
    }
    if (depth > maxDepth) {
      violations.push(`<scan-bounded: depth > ${maxDepth} at ${rel === "" ? "." : rel}>`);
      bounded = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (bounded) {
        return;
      }
      // `.git` is git's own internal tree — never Fabric-executed; skip it.
      if (rel === "" && entry === ".git") {
        continue;
      }
      entriesScanned += 1;
      if (entriesScanned > maxEntries) {
        violations.push(`<scan-bounded: entries > ${maxEntries}>`);
        bounded = true;
        return;
      }
      const abs = join(dir, entry);
      const relPath = rel === "" ? entry : `${rel}/${entry}`;
      let stat;
      try {
        stat = lstatSync(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        violations.push(relPath);
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs, relPath, depth + 1);
        continue;
      }
      // A regular file is a violation if it carries any executable bit OR has a
      // script/hook extension — knowledge stores are pure markdown/JSON.
      if ((stat.mode & 0o111) !== 0 || hasScriptExtension(entry)) {
        violations.push(relPath);
      }
    }
  };
  walk(absDir, "", 0);
  return violations;
}
