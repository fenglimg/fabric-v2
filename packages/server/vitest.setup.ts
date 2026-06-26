import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, afterEach } from "vitest";

import { __resetEmbedderForTesting } from "./src/services/vector-retrieval.js";

// Global FABRIC_HOME isolation baseline.
//
// `resolveGlobalRoot()` is fail-closed under the test runner: with FABRIC_HOME
// unset it THROWS rather than silently resolving to the developer's real
// ~/.fabric (a leak that once wrote a test fixture — `uid:"test-uid"` + seeded
// KT-DEC-* entries — into a real machine, deregistering the user's real stores).
// Giving every test a fresh isolated FABRIC_HOME here means a test that touches
// the global store registry without its own per-suite isolation still never
// reaches real ~/.fabric. Suites that repoint FABRIC_HOME in their own
// beforeEach (registered AFTER this one) simply override this default and clean
// up their own dir; this hook restores + removes the baseline dir afterward.
let baselineFabricHome: string | undefined;
let priorFabricHome: string | undefined;

// Global hermetic baseline for the optional vector embedder.
//
// TASK-004 made `embed_enabled` default TRUE, so any test that drives planContext
// / recall / triage would otherwise hit the real lazy `loadEmbedder` — which tries
// to import `fastembed` and download the model into the test's isolated FABRIC_HOME.
// That is slow (5s+ → test timeouts) and non-deterministic (when vectors DO fire
// they perturb the BM25-calibrated rank assertions). Forcing the embedder to a
// cached `null` before every test makes the vector path an instant no-op, so the
// whole suite ranks on BM25 + structural deterministically and never touches the
// network.
//
// Tests that specifically exercise embeddings inject their own fake via
// `__resetEmbedderForTesting(fakeEmbedder)` AFTER this hook (it runs first), and
// the loadEmbedder degradation tests drive `__setEmbedderModuleLoaderForTesting` +
// `__resetEmbedderForTesting(undefined)` to re-probe — both override this baseline.
// `afterEach` restores the real lazy probe so nothing leaks across files.
beforeEach(() => {
  __resetEmbedderForTesting(null);
  priorFabricHome = process.env.FABRIC_HOME;
  baselineFabricHome = mkdtempSync(join(tmpdir(), "fabric-test-home-"));
  process.env.FABRIC_HOME = baselineFabricHome;
});

afterEach(() => {
  __resetEmbedderForTesting(undefined);
  if (priorFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = priorFabricHome;
  }
  if (baselineFabricHome !== undefined) {
    rmSync(baselineFabricHome, { recursive: true, force: true });
    baselineFabricHome = undefined;
  }
});
