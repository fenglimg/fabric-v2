import { Box, Text } from "ink";
import type { ErrorInfo } from "./types.js";

export interface ErrorBoxProps {
  /** Error information */
  error: ErrorInfo;
  /** Show stack trace */
  showStack?: boolean;
}

/**
 * ErrorBox - Displays an error in a boxed format
 */
export function ErrorBox({ error, showStack = false }: ErrorBoxProps) {
  const title = error.title || "Error";
  const code = "code" in error ? error.code : undefined;
  const hint = "hint" in error ? error.hint : undefined;
  const stack = "stack" in error ? error.stack : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={1}
    >
      {/* Error title with optional code */}
      <Box gap={1}>
        <Text color="red" bold>
          ✗ {title}
        </Text>
        {code && (
          <Text dimColor>
            ({code})
          </Text>
        )}
      </Box>

      {/* Error message */}
      <Box marginTop={1}>
        <Text color="red">
          {error.message}
        </Text>
      </Box>

      {/* Hint */}
      {hint && (
        <Box marginTop={1}>
          <Text dimColor>
            💡 {hint}
          </Text>
        </Box>
      )}

      {/* Stack trace (only in verbose mode) */}
      {showStack && stack && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Stack trace:</Text>
          <Box marginLeft={2}>
            <Text dimColor color="gray">
              {stack.split("\n").slice(0, 5).join("\n")}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Convert Error to ErrorInfo
 */
export function toErrorInfo(error: Error | ErrorInfo): ErrorInfo {
  if ("title" in error) {
    return error;
  }
  return {
    title: error.name || "Error",
    message: error.message,
    stack: error.stack,
  };
}