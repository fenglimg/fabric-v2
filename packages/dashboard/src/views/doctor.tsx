import type { FabricEvent } from "@fenglimg/fabric-shared";
import { useEffect, useState } from "preact/hooks";

import { getDoctor, type DoctorCheck, type DoctorReport, type DoctorStatus } from "../api/client";
import { DriftIndicator } from "../components";
import { useI18n } from "../i18n/use-i18n";
import { ViewHeader } from "./rules-tree";

export type DoctorViewProps = {
  lastEvent: FabricEvent | null;
};

export function DoctorView({ lastEvent }: DoctorViewProps) {
  const { locale, t } = useI18n();
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
        title={t("dashboard.doctor.title")}
        subtitle={t("dashboard.doctor.subtitle")}
      />
      {error !== null ? <DriftIndicator kind="banner" severity="stale" message={error} /> : null}
      <div className="filter-bar doctor-toolbar">
        <span className="filter-label">{t("dashboard.doctor.toolbar.overall")}</span>
        <DriftIndicator
          kind="pill"
          severity={mapSeverity(report?.status ?? "warn")}
          message={report === null ? t("dashboard.shared.loading") : t(`dashboard.shared.status.${report.status}`)}
        />
        <span className="filter-date">
          {report === null
            ? t("dashboard.doctor.toolbar.no-summary")
            : report.summary.entryPoints.length === 1
              ? t("dashboard.doctor.toolbar.entry-point-summary", {
                  framework: formatFramework(report.summary.framework, t),
                  count: "1",
                })
              : t("dashboard.doctor.toolbar.entry-points-summary", {
                  framework: formatFramework(report.summary.framework, t),
                  count: String(report.summary.entryPoints.length),
                })}
        </span>
        <button className="ghost-button" type="button" onClick={() => void load()}>{t("dashboard.shared.refresh")}</button>
      </div>
      {loading && report === null ? <div className="empty-card">{t("dashboard.doctor.empty.loading")}</div> : null}
      {report !== null ? (
        <div className="doctor-layout">
          <div className="doctor-summary-grid">
            <SummaryCard
              label={t("dashboard.doctor.summary.framework")}
              value={formatFramework(report.summary.framework, t)}
              detail={
                report.summary.metaRevision === null
                  ? t("dashboard.doctor.summary.no-meta-revision")
                  : `rev ${report.summary.metaRevision}`
              }
            />
            <SummaryCard
              label={t("dashboard.doctor.summary.protected-paths")}
              value={
                report.summary.protectedPathCount === 0
                  ? t("dashboard.doctor.summary.tracked-paths.none")
                  : t("dashboard.doctor.summary.tracked-paths.some", { count: String(report.summary.protectedPathCount) })
              }
              detail={
                report.summary.protectedPathsIntact
                  ? t("dashboard.doctor.summary.hashes-intact")
                  : t("dashboard.doctor.summary.drifted", { count: String(report.summary.driftCount) })
              }
            />
            <SummaryCard
              label={t("dashboard.doctor.summary.intent-ledger")}
              value={formatAge(report.summary.lastLedgerEntryAgeMs, t)}
              detail={
                report.summary.lastLedgerEntryTs === null
                  ? t("dashboard.doctor.summary.no-ledger-entries")
                  : new Date(report.summary.lastLedgerEntryTs).toLocaleString(locale)
              }
            />
          </div>
          <div className="doctor-panels">
            <article className="doctor-card">
              <div className="doctor-card-head">
                <h3>{t("dashboard.doctor.card.entry-points")}</h3>
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
                <div className="empty-card doctor-empty">{t("dashboard.doctor.empty.entry-points")}</div>
              )}
            </article>
            <article className="doctor-card">
              <div className="doctor-card-head">
                <h3>{t("dashboard.doctor.card.checks")}</h3>
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
  const { t } = useI18n();
  return (
    <div className={`doctor-check doctor-check-${check.status}`}>
      <div className="doctor-check-head">
        <strong>{check.name}</strong>
        <DriftIndicator kind="pill" severity={mapSeverity(check.status)} message={t(`dashboard.shared.status.${check.status}`)} />
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

function formatFramework(
  framework: DoctorReport["summary"]["framework"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  const parts = [framework.kind, framework.version, framework.subkind].filter(
    (part) => part !== "unknown",
  );

  return parts.length > 0 ? parts.join(" · ") : t("dashboard.doctor.framework.unknown");
}

function formatAge(
  ageMs: number | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (ageMs === null) {
    return t("dashboard.doctor.age.none");
  }

  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return t("dashboard.doctor.age.seconds", { count: String(seconds) });
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("dashboard.doctor.age.minutes", { count: String(minutes) });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t("dashboard.doctor.age.hours", { count: String(hours) });
  }

  const days = Math.floor(hours / 24);
  if (days < 14) {
    return t("dashboard.doctor.age.days", { count: String(days) });
  }

  return t("dashboard.doctor.age.weeks", { count: String(Math.floor(days / 7)) });
}
