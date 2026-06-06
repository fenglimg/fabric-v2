import { Box, Text } from "ink";
import type { SummaryInfo, SummaryDetailRow } from "./types.js";

export interface SummaryCardProps {
  /** Summary data */
  summary: SummaryInfo;
}

/**
 * Status indicator for detail rows
 */
function DetailStatus({ status }: { status?: SummaryDetailRow["status"] }) {
  if (!status) return null;

  const indicators: Record<string, { symbol: string; color: string }> = {
    success: { symbol: "✓", color: "green" },
    error: { symbol: "✗", color: "red" },
    skipped: { symbol: "○", color: "yellow" },
    info: { symbol: "ℹ", color: "blue" },
  };

  const { symbol, color } = indicators[status] || { symbol: "•", color: "white" };

  return (
    <Text color={color} bold>
      {symbol}
    </Text>
  );
}

/**
 * SummaryCard - Displays a summary card with results
 */
export function SummaryCard({ summary }: SummaryCardProps) {
  const { title, successCount, skippedCount = 0, errorCount = 0, details = [] } = summary;
  const totalCount = successCount + skippedCount + errorCount;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>

      {/* Counts row */}
      <Box gap={3}>
        {successCount > 0 && (
          <Box gap={1}>
            <Text color="green" bold>✓</Text>
            <Text>
              {successCount} succeeded
            </Text>
          </Box>
        )}
        {skippedCount > 0 && (
          <Box gap={1}>
            <Text color="yellow" bold>○</Text>
            <Text>
              {skippedCount} skipped
            </Text>
          </Box>
        )}
        {errorCount > 0 && (
          <Box gap={1}>
            <Text color="red" bold>✗</Text>
            <Text>
              {errorCount} failed
            </Text>
          </Box>
        )}
      </Box>

      {/* Details */}
      {details.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {details.map((detail, index) => (
            <Box key={index} gap={1}>
              <DetailStatus status={detail.status} />
              <Text dimColor>{detail.label}:</Text>
              <Text>{detail.value}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Summary line */}
      <Box marginTop={1}>
        <Text dimColor>
          {totalCount === successCount
            ? "All steps completed successfully"
            : errorCount > 0
              ? `${errorCount} step${errorCount > 1 ? "s" : ""} failed`
              : `${successCount}/${totalCount} steps completed`}
        </Text>
      </Box>
    </Box>
  );
}