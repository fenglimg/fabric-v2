import { useI18n } from "../i18n/use-i18n";

export type DriftIndicatorProps = {
  kind: "dot" | "pill" | "banner";
  severity: "drift" | "stale" | "orphan" | "locked" | "ok";
  message?: string;
  diffStats?: { added: number; removed: number };
};

const defaultMessage: Record<DriftIndicatorProps["severity"], string> = {
  ok: "dashboard.shared.status.confirmed",
  drift: "dashboard.shared.status.hash-drift",
  stale: "dashboard.shared.status.stale",
  orphan: "dashboard.shared.status.orphan",
  locked: "dashboard.shared.status.attention",
};

export function DriftIndicator({ kind, severity, message, diffStats }: DriftIndicatorProps) {
  const { t } = useI18n();
  if (severity === "ok" && kind === "dot") {
    return null;
  }

  const label = message ?? t(defaultMessage[severity]);
  const stats =
    diffStats === undefined ? "" : ` +${diffStats.added} / -${diffStats.removed}`;
  
  const basePillStyles = "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-widest uppercase border";
  const baseBannerStyles = "flex items-center gap-2 p-3 rounded-lg text-sm font-medium border shadow-sm";
  const baseDotStyles = "w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]";
  
  const severityStyles = {
    ok: "bg-green-500/10 border-green-500/30 text-green-600 dark:bg-green-500/20 dark:border-green-500/30 dark:text-green-400",
    drift: "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:bg-orange-500/20 dark:border-orange-500/30 dark:text-orange-400",
    stale: "bg-red-500/10 border-red-500/30 text-red-600 dark:bg-red-500/20 dark:border-red-500/30 dark:text-red-400",
    orphan: "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:bg-slate-500/20 dark:border-slate-500/30 dark:text-slate-400",
    locked: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:bg-amber-500/20 dark:border-amber-500/30 dark:text-amber-400",
  };

  const dotSeverityStyles = {
    ok: "bg-green-500 text-green-500",
    drift: "bg-orange-500 text-orange-500 animate-pulse",
    stale: "bg-red-500 text-red-500 animate-pulse",
    orphan: "bg-slate-500 text-slate-500",
    locked: "bg-amber-500 text-amber-500",
  };

  if (kind === "dot") {
    return <span class={`${baseDotStyles} ${dotSeverityStyles[severity]}`} aria-label={label} />;
  }

  if (kind === "banner") {
    return (
      <div class={`${baseBannerStyles} ${severityStyles[severity]}`} role="status">
        <span aria-hidden="true" class="shrink-0">{severity === "ok" ? "✓" : "!"}</span>
        <span>{label}{stats}</span>
      </div>
    );
  }

  return (
    <span class={`${basePillStyles} ${severityStyles[severity]}`}>
      <span aria-hidden="true">{severity === "ok" ? "✓" : "!"}</span>
      <span class="truncate max-w-[150px] sm:max-w-none">{label}{stats}</span>
    </span>
  );
}