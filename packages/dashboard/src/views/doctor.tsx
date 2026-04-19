import type { FabricEvent } from "@fabric/shared";
import { useEffect, useState } from "preact/hooks";

import { getDoctor, type DoctorCheck, type DoctorReport, type DoctorStatus } from "../api/client";
import { DriftIndicator } from "../components";
import { ViewHeader } from "./rules-tree";

export type DoctorViewProps = {
  lastEvent: FabricEvent | null;
};

export function DoctorView({ lastEvent }: DoctorViewProps) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);

    try {
      setReport(await getDoctor());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (
      lastEvent?.type === "meta:updated" ||
      lastEvent?.type === "lock:approved" ||
      lastEvent?.type === "lock:drift" ||
      lastEvent?.type === "ledger:appended" ||
      lastEvent?.type === "drift:detected"
    ) {
      void load();
    }
  }, [lastEvent]);

  return (
    <section className="view">
      <ViewHeader
        title="Doctor Console"
        subtitle="fab doctor surface · framework, entry points, revision drift, protected paths"
      />
      {error !== null ? <DriftIndicator kind="banner" severity="stale" message={error} /> : null}
      <div className="filter-bar doctor-toolbar">
        <span className="filter-label">Overall</span>
        <DriftIndicator
          kind="pill"
          severity={mapSeverity(report?.status ?? "warn")}
          message={report === null ? "loading" : report.status}
        />
        <span className="filter-date">
          {report === null
            ? "No summary yet"
            : `${formatFramework(report.summary.framework)} · ${report.summary.entryPoints.length} entry point${report.summary.entryPoints.length === 1 ? "" : "s"}`}
        </span>
        <button className="ghost-button" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {loading && report === null ? <div className="empty-card">Loading doctor report...</div> : null}
      {report !== null ? (
        <div className="doctor-layout">
          <div className="doctor-summary-grid">
            <SummaryCard
              label="Framework"
              value={formatFramework(report.summary.framework)}
              detail={
                report.summary.metaRevision === null
                  ? "No meta revision yet"
                  : `rev ${report.summary.metaRevision}`
              }
            />
            <SummaryCard
              label="Protected paths"
              value={
                report.summary.protectedPathCount === 0
                  ? "No tracked paths"
                  : `${report.summary.protectedPathCount} tracked`
              }
              detail={
                report.summary.protectedPathsIntact
                  ? "All approved hashes intact"
                  : `${report.summary.driftCount} drifted`
              }
            />
            <SummaryCard
              label="Intent ledger"
              value={formatAge(report.summary.lastLedgerEntryAgeMs)}
              detail={
                report.summary.lastLedgerEntryTs === null
                  ? "No ledger entries yet"
                  : new Date(report.summary.lastLedgerEntryTs).toLocaleString()
              }
            />
          </div>
          <div className="doctor-panels">
            <article className="doctor-card">
              <div className="doctor-card-head">
                <h3>Entry points</h3>
                <span>{report.summary.entryPoints.length}</span>
              </div>
              {report.summary.entryPoints.length > 0 ? (
                <div className="doctor-entry-list">
                  {report.summary.entryPoints.map((entry) => (
                    <div key={`${entry.path}:${entry.reason}`} className="doctor-entry">
                      <strong>{entry.path}</strong>
                      <span>{entry.reason}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-card doctor-empty">No current entry points detected.</div>
              )}
            </article>
            <article className="doctor-card">
              <div className="doctor-card-head">
                <h3>Checks</h3>
                <span>{report.checks.length}</span>
              </div>
              <div className="doctor-check-list">
                {report.checks.map((check) => (
                  <CheckRow key={check.name} check={check} />
                ))}
              </div>
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="doctor-summary-card">
      <span className="doctor-summary-label">{label}</span>
      <strong className="doctor-summary-value">{value}</strong>
      <span className="doctor-summary-detail">{detail}</span>
    </article>
  );
}

function CheckRow({ check }: { check: DoctorCheck }) {
  return (
    <div className={`doctor-check doctor-check-${check.status}`}>
      <div className="doctor-check-head">
        <strong>{check.name}</strong>
        <DriftIndicator kind="pill" severity={mapSeverity(check.status)} message={check.status} />
      </div>
      <p>{check.message}</p>
    </div>
  );
}

function mapSeverity(status: DoctorStatus): "ok" | "locked" | "stale" {
  switch (status) {
    case "ok":
      return "ok";
    case "warn":
      return "locked";
    case "error":
      return "stale";
  }
}

function formatFramework(framework: DoctorReport["summary"]["framework"]): string {
  const parts = [framework.kind, framework.version, framework.subkind].filter(
    (part) => part !== "unknown",
  );

  return parts.length > 0 ? parts.join(" · ") : "unknown";
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) {
    return "No entries";
  }

  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `${days}d ago`;
  }

  return `${Math.floor(days / 7)}w ago`;
}
