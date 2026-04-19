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
  const className = `drift-indicator drift-${kind} drift-${severity}`;

  if (kind === "dot") {
    return <span className={className} aria-label={label} />;
  }

  if (kind === "banner") {
    return (
      <div className={className} role="status">
        <span aria-hidden="true">!</span>
        <span>{label}{stats}</span>
      </div>
    );
  }

  return (
    <span className={className}>
      <span aria-hidden="true">{severity === "ok" ? "✓" : "!"}</span>
      <span>{label}{stats}</span>
    </span>
  );
}
