import { useState, useEffect } from "react";
import { Text } from "ink";

export interface SpinnerProps {
  /** Label to show next to spinner */
  label?: string;
}

/**
 * Spinner frames
 */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Spinner - Animated loading indicator
 */
export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="cyan">
      {FRAMES[frame]} {label || "Loading..."}
    </Text>
  );
}

/**
 * SpinnerDots - Alternative dots-based spinner
 */
export function SpinnerDots({ label }: SpinnerProps) {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 300);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="cyan">
      {label || "Loading"}
      {dots}
    </Text>
  );
}