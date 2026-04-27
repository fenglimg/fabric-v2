import type { FabricEvent } from "@fenglimg/fabric-shared";
import { useEffect, useState } from "preact/hooks";

import { getDoctor, type DoctorCheck, type DoctorReport, type DoctorStatus } from "../api/client";
import { DriftIndicator } from "../components/drift-indicator";
import { useI18n } from "../i18n/use-i18n";

export type HealthViewProps = {
  lastEvent: FabricEvent | null;
  connected?: boolean;
};

export function HealthView({ lastEvent, connected = false }: HealthViewProps) {
  const { t } = useI18n();
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
      lastEvent?.type === "ledger:appended" ||
      lastEvent?.type === "drift:detected"
    ) {
      void load();
    }
  }, [lastEvent]);

  return (
    <div class="flex-1 flex flex-col gap-6 max-w-5xl mx-auto w-full p-4 md:p-6 lg:p-8">
      {error !== null ? (
        <div class="mb-4">
          <DriftIndicator kind="banner" severity="stale" message={error} />
        </div>
      ) : null}
      
      <div class="flex items-center justify-between bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl sm:rounded-2xl sm:shadow-sm p-4 flex-wrap gap-4">
        <div class="flex items-center gap-3">
          <span class="text-xs font-bold uppercase tracking-wider text-light-muted dark:text-dark-muted">{t("dashboard.doctor.toolbar.overall")}</span>
          <DriftIndicator
            kind="pill"
            severity={mapSeverity(report?.status ?? "warn")}
            message={report === null ? t("dashboard.shared.loading") : t(`dashboard.shared.status.${report.status}`)}
          />
        </div>
        
        <div class="flex items-center gap-4 ml-auto">
          <span class="font-mono text-sm text-light-muted dark:text-dark-muted hidden md:inline">
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
          
          <span class={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full uppercase ${connected ? "bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400"}`}>
            <span class={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500 shadow-[0_0_8px_#22c55e] animate-pulse" : "bg-red-500 shadow-[0_0_8px_#ef4444]"}`}></span>
            {connected ? t("dashboard.health.runtime.connected") : t("dashboard.health.runtime.disconnected")}
          </span>
          
          <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-light-border/50 hover:bg-light-border text-light-text dark:bg-white/10 dark:hover:bg-white/20 dark:text-dark-text transition-colors" type="button" onClick={() => void load()}>
            {t("dashboard.shared.refresh")}
          </button>
        </div>
      </div>

      {loading && report === null ? (
        <div class="p-8 text-center text-sm text-light-muted dark:text-dark-muted bg-light-surface border border-light-border dark:bg-dark-surface dark:border-dark-border sm:rounded-2xl">
          {t("dashboard.doctor.empty.loading")}
        </div>
      ) : null}
      
      {report !== null ? (
        <div class="flex flex-col gap-6">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
              label="Rule index"
              value={`${report.summary.ruleCount} rules`}
              detail={report.summary.computedMetaRevision === null ? t("dashboard.doctor.summary.no-meta-revision") : `computed ${report.summary.computedMetaRevision}`}
            />
            <SummaryCard
              label="Issues"
              value={`${report.summary.fixableErrorCount}/${report.summary.manualErrorCount}/${report.summary.warningCount}`}
              detail="fixable / manual / warnings"
            />
            <SummaryCard
              label={t("dashboard.health.ledger-path.label")}
              value={report.summary.eventLedgerPath}
              detail={t("dashboard.health.ledger-path.detail")}
            />
          </div>
          
          <div class="p-5 sm:p-6 rounded-2xl border bg-brand-warning/5 border-brand-warning/30 dark:bg-amber-500/5 dark:border-amber-500/20 relative overflow-hidden shadow-sm">
            <div class="absolute top-0 left-0 w-1 h-full bg-brand-warning dark:bg-amber-500 shadow-[0_0_10px_#f59e0b]"></div>
            <h3 class="text-sm font-bold mb-2 flex items-center gap-2 text-brand-warning dark:text-amber-400">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              {t("dashboard.health.boundary.title")}
            </h3>
            <p class="text-sm mb-4 text-light-text dark:text-dark-muted">
              {t("dashboard.health.boundary.description")}
            </p>
            {report.summary.fixableErrorCount > 0 && (
              <div class="mt-4">
                <strong class="text-sm text-brand-warning dark:text-amber-400 block mb-2">{t("dashboard.health.boundary.cli-action")}</strong>
                <p class="text-xs text-light-muted dark:text-dark-muted mb-2">{t("dashboard.health.boundary.cli-prompt", { count: String(report.summary.fixableErrorCount) })}</p>
                <div class="rounded-lg p-3 font-mono text-xs flex justify-between items-center border shadow-inner bg-zinc-900 border-zinc-800 text-zinc-300 dark:bg-black/50 dark:border-white/5 dark:text-white/80">
                  <span><span class="text-zinc-500 dark:text-white/30 mr-2">$</span>fabric doctor --fix</span>
                  <button class="text-zinc-400 hover:text-white dark:text-white/40 dark:hover:text-white transition-colors flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded" onClick={() => navigator.clipboard.writeText("fabric doctor --fix")}>
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <article class="flex flex-col bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-3xl overflow-hidden">
              <div class="p-5 border-b border-light-border dark:border-dark-border bg-light-surface/90 dark:bg-transparent flex justify-between items-center">
                <h3 class="text-sm font-bold uppercase tracking-wider text-light-text dark:text-dark-text m-0">{t("dashboard.doctor.card.entry-points")}</h3>
                <span class="text-[10px] font-mono bg-light-border/50 dark:bg-white/10 px-2 py-0.5 rounded-full border border-light-border dark:border-dark-border">{report.summary.entryPoints.length}</span>
              </div>
              {report.summary.entryPoints.length > 0 ? (
                <div class="flex flex-col">
                  {report.summary.entryPoints.map((entry) => (
                    <div key={`${entry.path}:${entry.reason}`} class="p-5 flex flex-col gap-1 border-b border-light-border dark:border-dark-border last:border-0 hover:bg-light-border/10 dark:hover:bg-white/5 transition-colors">
                      <strong class="font-mono text-sm text-light-text dark:text-dark-text break-all">{entry.path}</strong>
                      <span class="text-xs text-light-muted dark:text-dark-muted">{entry.reason}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div class="p-8 text-center text-sm text-light-muted dark:text-dark-muted">
                  {t("dashboard.doctor.empty.entry-points")}
                </div>
              )}
            </article>
            
            <article class="flex flex-col bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-3xl overflow-hidden">
              <div class="p-5 border-b border-light-border dark:border-dark-border bg-light-surface/90 dark:bg-transparent flex justify-between items-center">
                <h3 class="text-sm font-bold uppercase tracking-wider text-light-text dark:text-dark-text m-0">{t("dashboard.doctor.card.checks")}</h3>
                <span class="text-[10px] font-mono bg-light-border/50 dark:bg-white/10 px-2 py-0.5 rounded-full border border-light-border dark:border-dark-border">{report.checks.length}</span>
              </div>
              <div class="flex flex-col">
                {report.checks.map((check) => (
                  <CheckRow key={check.name} check={check} />
                ))}
              </div>
            </article>
          </div>
        </div>
      ) : null}
    </div>
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
    <article class="p-4 sm:p-5 flex flex-col gap-2 bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-3xl">
      <span class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest">{label}</span>
      <strong class="text-xl sm:text-2xl font-bold text-light-text dark:text-dark-text truncate" title={value}>{value}</strong>
      <span class="font-mono text-xs text-light-muted dark:text-dark-muted truncate" title={detail}>{detail}</span>
    </article>
  );
}

function CheckRow({ check }: { check: DoctorCheck }) {
  const { t } = useI18n();
  const severity = mapSeverity(check.status);
  const bgColors = {
    ok: "bg-green-500/5 dark:bg-green-500/10",
    locked: "bg-amber-500/5 dark:bg-amber-500/10",
    stale: "bg-red-500/5 dark:bg-red-500/10"
  };
  
  return (
    <div class={`p-5 flex flex-col gap-2 border-b border-light-border dark:border-dark-border last:border-0 ${bgColors[severity]}`}>
      <div class="flex items-center justify-between">
        <strong class="font-mono text-sm text-light-text dark:text-dark-text">{check.name}</strong>
        <DriftIndicator kind="pill" severity={severity} message={t(`dashboard.shared.status.${check.status}`)} />
      </div>
      <p class="text-sm text-light-muted dark:text-dark-muted m-0">{check.message}</p>
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