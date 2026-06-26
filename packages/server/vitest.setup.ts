import { beforeEach, afterEach } from "vitest";

import { __resetEmbedderForTesting } from "./src/services/vector-retrieval.js";

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
});

afterEach(() => {
  __resetEmbedderForTesting(undefined);
});
