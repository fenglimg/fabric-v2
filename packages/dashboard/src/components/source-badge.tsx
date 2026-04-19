import { useI18n } from "../i18n/use-i18n";

export type SourceBadgeProps = {
  source: "ai" | "human";
  size?: "sm" | "md";
  variant?: "filled" | "outline";
  interactive?: boolean;
  selected?: boolean;
  onClick?: () => void;
};

export function SourceBadge({
  source,
  size = "sm",
  variant = "filled",
  interactive = false,
  selected = false,
  onClick,
}: SourceBadgeProps) {
  const { t } = useI18n();
  const className = [
    "source-badge",
    `source-badge-${source}`,
    `source-badge-${size}`,
    `source-badge-${variant}`,
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = t(`dashboard.source.${source}`);

  if (interactive) {
    return (
      <button className={className} type="button" aria-pressed={selected} onClick={onClick}>
        <span className="source-badge-dot" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <span className={className}>
      <span className="source-badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
