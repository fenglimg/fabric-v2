import type { AiLedgerEntry, FabricEvent, LedgerEntry } from "@fabric/shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { annotateIntent, getLedger } from "../api/client";
import { SourceBadge, TimelineEntry } from "../components";
import { ViewHeader } from "./rules-tree";

export type IntentTimelineViewProps = {
  lastEvent: FabricEvent | null;
};

type SourceFilter = "all" | "ai" | "human";

export function IntentTimelineView({ lastEvent }: IntentTimelineViewProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setEntries((await getLedger()).sort((left, right) => right.ts - left.ts));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "ledger:appended") {
      setEntries((current) => [lastEvent.payload, ...current].sort((left, right) => right.ts - left.ts));
    }
  }, [lastEvent]);

  const visible = useMemo(
    () => entries.filter((entry) => filter === "all" || entry.source === filter),
    [entries, filter],
  );
  const aiCount = entries.filter((entry) => entry.source === "ai").length;
  const humanCount = entries.length - aiCount;

  const annotate = async (entry: AiLedgerEntry, text: string) => {
    if (entry.id === undefined) {
      throw new Error("Cannot annotate a ledger entry without an id.");
    }

    const result = await annotateIntent({ ledger_entry_id: entry.id, annotation: text });
    if (result.created) {
      setEntries((current) => [result.entry, ...current].sort((left, right) => right.ts - left.ts));
    }
  };

  return (
    <section className="view">
      <ViewHeader
        title="Intent Timeline"
        subtitle=".intent-ledger.jsonl · dual-column AI | Human · sorted by timestamp desc"
      />
      {error !== null ? <div className="empty-card">{error}</div> : null}
      <div className="filter-bar">
        <span className="filter-label">Source</span>
        <button className={`filter-chip ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")}>
          All {entries.length}
        </button>
        <SourceBadge source="ai" interactive selected={filter === "ai"} onClick={() => setFilter("ai")} />
        <SourceBadge source="human" interactive selected={filter === "human"} onClick={() => setFilter("human")} />
        <span className="filter-date">AI {aiCount} · Human {humanCount}</span>
      </div>
      <div className="col-headers">
        <div className="col-head ai"><strong>AI</strong><span>{aiCount} entries</span></div>
        <div className="col-head human"><strong>Human</strong><span>{humanCount} entries</span></div>
      </div>
      <div className="timeline-grid">
        <div className="axis"><div className="axis-line" /></div>
        {visible.length > 0 ? visible.map((entry) => (
          <TimelineEntry key={entry.id ?? `${entry.source}:${entry.ts}:${entry.intent}`} entry={entry} onAnnotate={annotate} />
        )) : <div className="empty-card timeline-empty">No ledger entries found.</div>}
      </div>
    </section>
  );
}
