import { useEffect, useState } from "preact/hooks";

import { getScan, type ScanReport } from "../api/client";
import { DriftIndicator } from "../components/drift-indicator";
import { useI18n } from "../i18n/use-i18n";

export function ReadinessView() {
  const { t } = useI18n();
  const [report, setReport] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setReport(await getScan());
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

  return (
    <div class="flex-1 flex flex-col gap-6 max-w-5xl mx-auto w-full p-4 md:p-6 lg:p-8">
      {error !== null ? (
        <div class="mb-4">
          <DriftIndicator kind="banner" severity="stale" message={error} />
        </div>
      ) : null}
      
      <div class="flex items-center justify-between bg-light-surface border border-light-border dark:bg-dark-surface dark:border-dark-border dark:backdrop-blur-xl sm:rounded-2xl sm:shadow-sm p-4">
        <span class="text-xs font-bold uppercase tracking-wider text-light-muted dark:text-dark-muted">{t("dashboard.readiness.filter.analysis")}</span>
        <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-light-border/50 hover:bg-light-border text-light-text dark:bg-white/10 dark:hover:bg-white/20 dark:text-dark-text transition-colors" type="button" onClick={() => void load()}>
          {t("dashboard.shared.refresh")}
        </button>
      </div>

      {loading && report === null ? (
        <div class="p-8 text-center text-sm text-light-muted dark:text-dark-muted bg-light-surface border border-light-border dark:bg-dark-surface dark:border-dark-border sm:rounded-2xl">
          {t("dashboard.readiness.loading")}
        </div>
      ) : null}
      
      {report !== null ? (
        <div class="flex flex-col gap-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <article class="p-5 flex flex-col gap-2 bg-light-surface border border-light-border dark:bg-dark-surface dark:border-dark-border sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-xl">
              <span class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest">{t("dashboard.readiness.summary.framework")}</span>
              <strong class="text-2xl font-bold text-light-text dark:text-dark-text">
                {report.framework.kind !== "unknown" ? `${report.framework.kind} ${report.framework.version}` : t("dashboard.doctor.framework.unknown")}
              </strong>
              <span class="font-mono text-xs text-light-muted dark:text-dark-muted">{report.framework.subkind !== "unknown" ? report.framework.subkind : "Standard"}</span>
            </article>
            
            <article class="p-5 flex flex-col gap-2 bg-light-surface border border-light-border dark:bg-dark-surface dark:border-dark-border sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-xl">
              <span class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest">{t("dashboard.readiness.summary.files")}</span>
              <strong class="text-2xl font-bold text-light-text dark:text-dark-text">{report.fileCount}</strong>
              <span class="font-mono text-xs text-light-muted dark:text-dark-muted">{report.ignoredCount} ignored</span>
            </article>
            
            <article class="p-5 flex flex-col gap-2 bg-light-surface border border-light-border dark:bg-dark-surface dark:border-dark-border sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-xl">
              <span class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest">{t("dashboard.readiness.summary.status")}</span>
              <strong class="text-2xl font-bold text-light-text dark:text-dark-text">
                {report.hasExistingFabric ? "Initialized" : "Not Initialized"}
              </strong>
              <span class="font-mono text-xs text-light-muted dark:text-dark-muted">.fabric directory</span>
            </article>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <article class="flex flex-col bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-3xl overflow-hidden">
              <div class="p-5 border-b border-light-border dark:border-dark-border bg-light-surface/90 dark:bg-transparent">
                <h3 class="text-sm font-bold uppercase tracking-wider text-light-text dark:text-dark-text m-0">{t("dashboard.readiness.card.evidence")}</h3>
              </div>
              <div class="flex flex-col">
                <div class={`p-5 flex flex-col gap-2 border-b border-light-border dark:border-dark-border ${report.readmeQuality === 'none' ? 'bg-red-500/5 dark:bg-red-500/10' : ''}`}>
                  <div class="flex items-center justify-between">
                    <strong class="font-mono text-sm text-light-text dark:text-dark-text">README.md</strong>
                    <DriftIndicator kind="pill" severity={report.readmeQuality === "none" ? "stale" : "ok"} message={report.readmeQuality} />
                  </div>
                  <p class="text-sm text-light-muted dark:text-dark-muted m-0">{t("dashboard.readiness.readme.description")}</p>
                </div>
                <div class={`p-5 flex flex-col gap-2 ${report.hasContributing ? '' : 'bg-amber-500/5 dark:bg-amber-500/10'}`}>
                  <div class="flex items-center justify-between">
                    <strong class="font-mono text-sm text-light-text dark:text-dark-text">CONTRIBUTING.md</strong>
                    <DriftIndicator kind="pill" severity={report.hasContributing ? "ok" : "locked"} message={report.hasContributing ? "Present" : "Missing"} />
                  </div>
                  <p class="text-sm text-light-muted dark:text-dark-muted m-0">{t("dashboard.readiness.contributing.description")}</p>
                </div>
              </div>
            </article>

            <article class="flex flex-col bg-light-surface border border-light-border dark:bg-dark-surface dark:border-white/5 sm:rounded-2xl sm:shadow-sm dark:shadow-xl dark:backdrop-blur-3xl overflow-hidden">
              <div class="p-5 border-b border-light-border dark:border-dark-border bg-light-surface/90 dark:bg-transparent">
                <h3 class="text-sm font-bold uppercase tracking-wider text-light-text dark:text-dark-text m-0">{t("dashboard.readiness.card.recommendations")}</h3>
              </div>
              <div class="flex flex-col p-5 gap-4">
                {report.recommendations.length > 0 ? report.recommendations.map((rec, i) => (
                  <div key={i} class="flex items-start gap-3 pb-4 border-b border-light-border dark:border-dark-border last:border-0 last:pb-0">
                    <div class="w-1.5 h-1.5 rounded-full bg-brand-accent mt-2 shrink-0"></div>
                    <span class="text-sm text-light-text dark:text-dark-text leading-relaxed">{rec}</span>
                  </div>
                )) : (
                  <div class="text-sm text-light-muted dark:text-dark-muted text-center py-4">
                    <span>{t("dashboard.readiness.fully-ready")}</span>
                  </div>
                )}
                
                {!report.hasExistingFabric && (
                  <div class="mt-2 p-4 rounded-xl border bg-brand-accent/5 border-brand-accent/20 dark:bg-brand-accent/10 dark:border-brand-accent/20">
                    <strong class="text-sm text-brand-accent dark:text-blue-400 block mb-2">{t("dashboard.readiness.init-prompt")}</strong>
                    <div class="rounded-lg p-3 font-mono text-xs flex justify-between items-center border shadow-inner bg-zinc-900 border-zinc-800 text-zinc-300 dark:bg-black/50 dark:border-white/5 dark:text-white/80">
                      <span><span class="text-zinc-500 dark:text-white/30 mr-2">$</span>fab init</span>
                      <button class="text-zinc-400 hover:text-white dark:text-white/40 dark:hover:text-white transition-colors flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded" onClick={() => navigator.clipboard.writeText("fab init")}>
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          </div>
        </div>
      ) : null}
    </div>
  );
}