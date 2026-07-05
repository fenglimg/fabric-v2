// RED-baseline dogfood harness (NOT a normal regression test — gated behind
// DOGFOOD_BASELINE=1 so `pnpm test` / CI skip it; it ranges over the machine's
// REAL ~/.fabric team+personal stores, which is intentionally non-hermetic).
//
// Thesis (process KB self-retrieval-dogfood-recall-tdd): every narrow knowledge
// entry ships its own test contract — `relevance_paths` (the files whose edit
// should surface it) + `intent_clues` (the triggering intent). This harness holds
// the ranker accountable to that contract: for each narrow entry E, query recall
// with paths=E.relevance_paths + intent=E.intent_clues (NOT summary — that would
// be circular self-proof) and assert E surfaces near the top. Aggregated over the
// whole real KB it yields the RED baseline scoreboard:
//   - self-retrieval@1 / @3 / found-in-returned rate + miss rate
//   - median / p90 self rank
//   - payload byte distribution (the 41KB problem, quantified)
//   - score ≠ score_breakdown.final count (the proximity-omission bug, live)
//   - contested-path ordering samples (files ≥3 entries claim — the real battle)
//
// Run: DOGFOOD_BASELINE=1 pnpm --filter @fenglimg/fabric-server exec vitest run \
//        src/services/recall-dogfood-baseline.test.ts

import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import { recall } from "./recall.js";
import { buildCrossStoreRawItems } from "./cross-store-recall.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

describe.runIf(process.env.DOGFOOD_BASELINE === "1")("recall dogfood RED baseline", () => {
  it(
    "self-retrieval scoreboard over the real KB",
    async () => {
      // The server vitest setup repoints FABRIC_HOME to an isolated temp home for
      // hermeticity (global-config-io fail-closed guard). This dogfood harness is
      // READ-ONLY (recall only, never fab_propose) and deliberately ranges over the
      // developer's REAL store, so we point it back to the real home for this run.
      process.env.FABRIC_HOME = homedir();

      const items = await buildCrossStoreRawItems(REPO_ROOT);
      const narrow = items.filter((i) => (i.description.relevance_paths ?? []).length > 0);
      const broadCount = items.length - narrow.length;

      // ---- contested paths: files ≥3 narrow entries declare relevant ----
      const pathToIds = new Map<string, string[]>();
      for (const item of narrow) {
        for (const p of item.description.relevance_paths ?? []) {
          const bucket = pathToIds.get(p) ?? [];
          bucket.push(item.stable_id);
          pathToIds.set(p, bucket);
        }
      }
      const contested = [...pathToIds.entries()]
        .filter(([, ids]) => ids.length >= 3)
        .sort((a, b) => b[1].length - a[1].length);

      // ---- per-entry self-retrieval ----
      type Row = {
        id: string;
        store: string;
        rank: number | null;
        found: boolean;
        returned: number;
        payload: number;
        intentSource: string;
        error?: string;
      };
      const rows: Row[] = [];
      let mismatchObs = 0;
      let totalObs = 0;
      const mismatchIds = new Set<string>();

      for (const item of narrow) {
        const rp = item.description.relevance_paths ?? [];
        const clues = item.description.intent_clues ?? [];
        const mustRead = item.description.must_read_if ?? "";
        const intentSource = clues.length > 0 ? "intent_clues" : mustRead ? "must_read_if" : "none";
        const intent = clues.length > 0 ? clues.join(" ") : mustRead;
        const store = item.stable_id.includes(":") ? item.stable_id.split(":")[0]! : "?";

        try {
          const res = await recall(REPO_ROOT, {
            paths: rp,
            target_paths: rp,
            intent,
            layer_filter: "both",
            session_id: "dogfood-baseline",
          });
          const entries = res.entries ?? [];
          const idx = entries.findIndex((e) => e.stable_id === item.stable_id);
          const rank = idx >= 0 ? (entries[idx]!.rank ?? idx + 1) : null;
          for (const e of entries) {
            if (typeof e.score === "number" && e.score_breakdown && typeof e.score_breakdown.final === "number") {
              totalObs++;
              if (Math.abs(e.score - e.score_breakdown.final) > 1e-6) {
                mismatchObs++;
                mismatchIds.add(e.stable_id);
              }
            }
          }
          rows.push({
            id: item.stable_id,
            store,
            rank,
            found: idx >= 0,
            returned: entries.length,
            payload: Buffer.byteLength(JSON.stringify(res), "utf8"),
            intentSource,
          });
        } catch (err) {
          rows.push({
            id: item.stable_id,
            store,
            rank: null,
            found: false,
            returned: 0,
            payload: 0,
            intentSource,
            error: String((err as Error)?.message ?? err),
          });
        }
      }

      // ---- aggregate ----
      const ok = rows.filter((r) => !r.error);
      const foundRanks = ok.filter((r) => r.found && r.rank !== null).map((r) => r.rank!);
      const misses = ok.filter((r) => !r.found);
      const payloads = ok.map((r) => r.payload).filter((n) => n > 0);
      const rate = (n: number) => (ok.length ? +((100 * n) / ok.length).toFixed(1) : 0);

      const scoreboard = {
        corpus: { total: items.length, narrow_tested: narrow.length, broad_skipped: broadCount, errors: rows.length - ok.length },
        self_retrieval: {
          at1_rate_pct: rate(foundRanks.filter((r) => r === 1).length),
          at3_rate_pct: rate(foundRanks.filter((r) => r <= 3).length),
          found_in_returned_pct: rate(ok.filter((r) => r.found).length),
          miss_rate_pct: rate(misses.length),
          median_rank: median(foundRanks),
          p90_rank: percentile(foundRanks, 90),
          worst_ranks: [...ok].filter((r) => r.found).sort((a, b) => b.rank! - a.rank!).slice(0, 8).map((r) => ({ id: r.id, rank: r.rank })),
          missed_ids: misses.map((r) => r.id),
        },
        payload_bytes: {
          min: payloads.length ? Math.min(...payloads) : null,
          median: median(payloads),
          p90: percentile(payloads, 90),
          max: payloads.length ? Math.max(...payloads) : null,
          over_16kb: payloads.filter((n) => n > 16384).length,
          over_64kb: payloads.filter((n) => n > 65536).length,
        },
        breakdown_invariant: {
          entry_observations: totalObs,
          final_ne_score: mismatchObs,
          mismatch_pct: totalObs ? +((100 * mismatchObs) / totalObs).toFixed(1) : 0,
          distinct_ids_affected: mismatchIds.size,
        },
        intent_source_mix: {
          intent_clues: ok.filter((r) => r.intentSource === "intent_clues").length,
          must_read_if: ok.filter((r) => r.intentSource === "must_read_if").length,
          none: ok.filter((r) => r.intentSource === "none").length,
        },
        contested_paths_count: contested.length,
      };

      // ---- contested-path ordering samples (top 3 files) ----
      const contestedSamples: unknown[] = [];
      for (const [p, ids] of contested.slice(0, 3)) {
        const res = await recall(REPO_ROOT, {
          paths: [p],
          target_paths: [p],
          intent: "",
          layer_filter: "both",
          session_id: "dogfood-baseline",
        });
        const entries = res.entries ?? [];
        const claimSet = new Set(ids);
        contestedSamples.push({
          path: p,
          claimants: ids.length,
          top8: entries.slice(0, 8).map((e) => ({ id: e.stable_id, rank: e.rank, claims_path: claimSet.has(e.stable_id) })),
          claimant_ranks: ids.map((id) => {
            const e = entries.find((x) => x.stable_id === id);
            return { id, rank: e ? e.rank : "MISS" };
          }),
        });
      }

      // eslint-disable-next-line no-console
      console.log(
        "\n===== RECALL DOGFOOD RED BASELINE =====\n" +
          JSON.stringify(scoreboard, null, 2) +
          "\n--- contested-path samples ---\n" +
          JSON.stringify(contestedSamples, null, 2) +
          "\n=======================================\n",
      );
    },
    240_000,
  );
});
