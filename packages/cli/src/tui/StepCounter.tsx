import { Box, Text } from "ink";

export interface StepCounterProps {
  /** Current step number (1-based) */
  current: number;
  /** Total number of steps */
  total: number;
  /** Step label */
  label: string;
  /** Step status */
  status?: "pending" | "running" | "success" | "error" | "skipped";
}

/**
 * Status color mapping
 */
const statusColors: Record<string, string> = {
  pending: "gray",
  running: "cyan",
  success: "green",
  error: "red",
  skipped: "yellow",
};

/**
 * Status symbols
 */
const statusSymbols: Record<string, string> = {
  pending: "○",
  running: "●",
  success: "✓",
  error: "✗",
  skipped: "○",
};

/**
 * StepCounter - Displays step progress like "(1/7)"
 */
export function StepCounter({
  current,
  total,
  label,
  status = "running",
}: StepCounterProps) {
  const color = statusColors[status] || "cyan";
  const symbol = statusSymbols[status] || "●";

  return (
    <Box gap={1}>
      <Text color={color} bold>
        {symbol}
      </Text>
      <Text dimColor>
        ({current}/{total})
      </Text>
      <Text bold>{label}</Text>
    </Box>
  );
}