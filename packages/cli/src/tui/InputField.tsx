import { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";

export interface InputFieldProps {
  /** Prompt message */
  message: string;
  /** Placeholder text */
  placeholder?: string;
  /** Initial value */
  initialValue?: string;
  /** Callback when user submits */
  onSubmit: (value: string) => void;
  /** Callback when user cancels */
  onCancel?: () => void;
  /** Is this field optional? */
  optional?: boolean;
}

/**
 * InputField - Text input component for wizard flows
 *
 * Allows users to type text input with backspace support.
 * Enter confirms, Escape cancels.
 */
export function InputField({
  message,
  placeholder,
  initialValue = "",
  onSubmit,
  onCancel,
  optional = false,
}: InputFieldProps) {
  const [value, setValue] = useState(initialValue);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
    } else if (key.escape) {
      if (onCancel) {
        onCancel();
      } else {
        onSubmit(optional ? "" : value);
      }
    } else if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  const displayValue = value || (placeholder ? `<${placeholder}>` : "");
  const showPlaceholder = value.length === 0 && placeholder;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {message}
        </Text>
        {optional && (
          <Text dimColor> (optional)</Text>
        )}
      </Box>
      <Box marginLeft={1}>
        <Text color="gray">{"❯ "}</Text>
        {showPlaceholder ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <Text>{value}</Text>
        )}
        <Text color="cyan" bold>_</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Type your input, Enter to confirm, Escape to {optional ? "skip" : "cancel"}
        </Text>
      </Box>
    </Box>
  );
}
