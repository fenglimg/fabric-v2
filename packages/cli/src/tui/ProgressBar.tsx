import { Box, Text } from "ink";

export interface ProgressBarProps {
  /** Current progress value */
  current: number;
  /** Total value */
  total: number;
  /** Label */
  label?: string;
  /** Bar width in characters */
  width?: number;
}

/**
 * ProgressBar - Visual progress indicator
 */
export function ProgressBar({
  current,
  total,
  label,
  width = 20,
}: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "░".repeat(empty);

  return (
    <Box flexDirection="column" gap={0}>
      {label && (
        <Text dimColor>{label}</Text>
      )}
      <Box gap={1}>
        <Text color="cyan">{bar}</Text>
        <Text dimColor>{Math.round(percent)}%</Text>
      </Box>
    </Box>
  );
}