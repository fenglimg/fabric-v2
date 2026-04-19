import type { FabricEvent, HumanLockEntry } from "@fabric/shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { approveHumanLock, getHumanLock, type HumanLockStatus } from "../api/client";
import { DriftIndicator, LockCard } from "../components";
import { ViewHeader } from "./rules-tree";

export type HumanLockViewProps = {
  lastEvent: FabricEvent | null;
};

export function HumanLockView({ lastEvent }: HumanLockViewProps) {
  const [entries, setEntries] = useState<HumanLockStatus[]>([]);
  const [filter, setFilter] = useState<"all" | "drift" | "approved">("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setEntries(await getHumanLock());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "lock:drift" || lastEvent?.type === "lock:approved") {
      void load();
    }
  }, [lastEvent]);

  const counts = useMemo(() => ({
    all: entries.length,
    drift: entries.filter((entry) => entry.drift).length,
    approved: entries.filter((entry) => !entry.drift).length,
  }), [entries]);
  const visible = entries.filter((entry) => filter === "all" || (filter === "drift" ? entry.drift : !entry.drift));

  const approve = async (entry: HumanLockEntry) => {
    const status = entries.find((candidate) => keyFor(candidate) === keyFor(entry));
    if (status === undefined) {
      return;
    }

    setBusyKey(keyFor(entry));
    try {
      const result = await approveHumanLock({
        file: status.file,
        start_line: status.start_line,
        end_line: status.end_line,
        new_hash: status.current_hash,
      });
      setEntries((current) => current.map((candidate) => keyFor(candidate) === keyFor(entry) ? result.entry : candidate));
      setError(null);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : String(approveError));
      throw approveError;
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="view">
      <ViewHeader
        title="Human Lock Vault"
        subtitle="Protected regions awaiting approval · ritual writes only"
      />
      {error !== null ? <DriftIndicator kind="banner" severity="drift" message={error} /> : null}
      <div className="filter-bar" role="tablist" aria-label="Human lock filters">
        {(["all", "drift", "approved"] as const).map((item) => (
          <button
            key={item}
            className={`filter-chip ${filter === item ? "active" : ""} ${item}`}
            type="button"
            role="tab"
            aria-selected={filter === item}
            onClick={() => setFilter(item)}
          >
            {item}<span className="count">{counts[item]}</span>
          </button>
        ))}
        <span className="filter-date">{counts.drift} drift · {counts.approved} confirmed</span>
      </div>
      <div className="lock-grid">
        {visible.length > 0 ? visible.map((entry) => (
          <LockCard
            key={keyFor(entry)}
            entry={entry}
            currentHash={entry.current_hash}
            onApprove={approve}
            busy={busyKey === keyFor(entry)}
          />
        )) : <div className="empty-card">No human lock entries for this filter.</div>}
      </div>
    </section>
  );
}

function keyFor(entry: HumanLockEntry): string {
  return `${entry.file}:${entry.start_line}:${entry.end_line}`;
}
