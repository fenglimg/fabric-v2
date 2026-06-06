import { Box, Text } from "ink";

export interface StatusMessageProps {
  /** Message to display */
  message: string;
  /** Message type */
  type: "success" | "error" | "warning" | "info";
  /** Show timestamp */
  timestamp?: boolean;
}

/**
 * Type color mapping
 */
const typeColors: Record<string, string> = {
  success: "green",
  error: "red",
  warning: "yellow",
  info: "blue",
};

/**
 * Type labels
 */
const typeLabels: Record<string, string> = {
  success: "✓",
  error: "✗",
  warning: "!",
  info: "ℹ",
};

/**
 * StatusMessage - Displays a status message with colored indicator
 */
export function StatusMessage({
  message,
  type,
  timestamp = false,
}: StatusMessageProps) {
  const color = typeColors[type] || "white";
  const label = typeLabels[type] || "•";

  const timeStr = timestamp
    ? `[${new Date().toLocaleTimeString()}] `
    : "";

  return (
    <Box gap={1}>
      <Text color={color} bold>
        {label}
      </Text>
      {timestamp && (
        <Text dimColor>{timeStr}</Text>
      )}
      <Text color={type === "error" ? "red" : undefined}>{message}</Text>
    </Box>
  );
}