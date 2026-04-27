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
  const label = t(`dashboard.source.${source}`);

  const baseStyles = "inline-flex items-center gap-1.5 rounded-full font-mono text-[10px] font-bold uppercase tracking-widest border transition-colors";
  const sizeStyles = size === "sm" ? "px-2 py-0.5" : "px-3 py-1";
  
  let themeStyles = "";
  if (source === "ai") {
    if (variant === "filled") {
      themeStyles = selected 
        ? "bg-brand-accent/20 border-brand-accent/50 text-brand-accent dark:bg-purple-500/30 dark:border-purple-500/50 dark:text-purple-300"
        : "bg-brand-accent/10 border-brand-accent/30 text-brand-accent/80 dark:bg-purple-500/10 dark:border-purple-500/30 dark:text-purple-400";
    } else {
      themeStyles = selected
        ? "bg-transparent border-brand-accent text-brand-accent dark:border-purple-500 dark:text-purple-400"
        : "bg-transparent border-brand-accent/30 text-brand-accent/70 dark:border-purple-500/30 dark:text-purple-400/70";
    }
  } else {
    // human
    if (variant === "filled") {
      themeStyles = selected 
        ? "bg-teal-500/20 border-teal-500/50 text-teal-600 dark:bg-teal-500/30 dark:border-teal-500/50 dark:text-teal-300"
        : "bg-teal-500/10 border-teal-500/30 text-teal-600/80 dark:bg-teal-500/10 dark:border-teal-500/30 dark:text-teal-400";
    } else {
      themeStyles = selected
        ? "bg-transparent border-teal-500 text-teal-600 dark:border-teal-500 dark:text-teal-400"
        : "bg-transparent border-teal-500/30 text-teal-600/70 dark:border-teal-500/30 dark:text-teal-400/70";
    }
  }

  const hoverStyles = interactive && !selected ? "hover:bg-opacity-80 dark:hover:bg-opacity-80 cursor-pointer" : "";
  const className = `${baseStyles} ${sizeStyles} ${themeStyles} ${hoverStyles}`;
  
  const dotColor = source === "ai" ? "bg-brand-accent dark:bg-purple-400" : "bg-teal-500 dark:bg-teal-400";

  if (interactive) {
    return (
      <button class={className} type="button" aria-pressed={selected} onClick={onClick}>
        <span class={`w-1.5 h-1.5 rounded-full ${dotColor} ${selected ? 'shadow-[0_0_8px_currentColor]' : ''}`} aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <span class={className}>
      <span class={`w-1.5 h-1.5 rounded-full ${dotColor} ${selected ? 'shadow-[0_0_8px_currentColor]' : ''}`} aria-hidden="true" />
      {label}
    </span>
  );
}