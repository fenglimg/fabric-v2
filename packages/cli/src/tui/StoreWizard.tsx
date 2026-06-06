import { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface StoreWizardChoice {
  /** Choice value */
  value: "skip" | "join" | "create";
  /** Display label */
  label: string;
  /** Hint text */
  hint: string;
}

export interface StoreWizardProps {
  /** Callback when user makes a selection */
  onSelect: (choice: "skip" | "join" | "create") => void;
  /** Optional title */
  title?: string;
}

const CHOICES: StoreWizardChoice[] = [
  {
    value: "skip",
    label: "Skip",
    hint: "Use personal store only (default)",
  },
  {
    value: "join",
    label: "Join existing",
    hint: "Clone + bind a shared store from a git remote",
  },
  {
    value: "create",
    label: "Create new",
    hint: "Start a fresh local store (optionally remote-backed)",
  },
];

/**
 * StoreWizard - Interactive store onboarding wizard
 *
 * Provides a keyboard-navigable menu for selecting the store setup path:
 * - Skip: Use personal store only
 * - Join: Clone and bind an existing team store
 * - Create: Create a new local store
 */
export function StoreWizard({ onSelect, title }: StoreWizardProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  useInput((input, key) => {
    if (confirmed) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? CHOICES.length - 1 : prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev === CHOICES.length - 1 ? 0 : prev + 1));
    } else if (key.return || input === " ") {
      setConfirmed(true);
      onSelect(CHOICES[selectedIndex].value);
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title ?? "Set up a team / shared knowledge store for this project?"}
        </Text>
      </Box>

      {/* Choices */}
      {CHOICES.map((choice, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={choice.value} marginLeft={1}>
            <Text
              color={isSelected ? "cyan" : "gray"}
              bold={isSelected}
            >
              {isSelected ? "❯ " : "  "}
              {choice.label}
            </Text>
            <Text dimColor> - {choice.hint}</Text>
          </Box>
        );
      })}

      {/* Instructions */}
      <Box marginTop={1}>
        <Text dimColor>
          Use ↑/↓ to select, Enter to confirm
        </Text>
      </Box>
    </Box>
  );
}
