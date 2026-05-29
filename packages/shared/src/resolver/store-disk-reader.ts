import { existsSync, readFileSync } from "node:fs";
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

// True when `absDir` is a recognizable v2.1 store root.
export function recognizeStoreDir(absDir: string): boolean {
  return readStoreIdentity(absDir) !== null;
}
