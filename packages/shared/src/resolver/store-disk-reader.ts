import { ResolverNotImplementedError } from "./project-root-resolver.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.5 — Store disk-reader TDD STUB (P1 implements).
//
// `recognizeStoreDir` decides whether an absolute directory is a v2.1 store —
// i.e. it contains a `store.json` parsing to storeIdentitySchema (S42/A2). The
// old-layout negative test (clean-slate S22/S66) asserts this returns FALSE for
// a v2.0-style in-repo `.fabric/knowledge/` directory (which has no store.json),
// proving the new reader does NOT pick up legacy layouts and no auto-migration
// is attempted. Throws until P1; the negative test is `it.fails` until then.
// ---------------------------------------------------------------------------

export function recognizeStoreDir(absDir: string): boolean {
  void absDir;
  throw new ResolverNotImplementedError("recognizeStoreDir");
}
