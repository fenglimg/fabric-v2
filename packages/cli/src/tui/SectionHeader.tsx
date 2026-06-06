import { Box, Text } from "ink";

export interface SectionHeaderProps {
  /** Section title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
}

/**
 * SectionHeader - Visual separator for sections
 */
export function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="classic" borderColor="gray">
        <Box paddingX={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
      </Box>
      {subtitle && (
        <Box marginLeft={2}>
          <Text dimColor>{subtitle}</Text>
        </Box>
      )}
    </Box>
  );
}