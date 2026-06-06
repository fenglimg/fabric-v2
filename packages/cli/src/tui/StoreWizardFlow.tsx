import React, { useState, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { StoreWizard } from "./StoreWizard.js";
import { InputField } from "./InputField.js";

export type StoreWizardResult =
  | { action: "skip" }
  | { action: "join"; url: string }
  | { action: "create"; alias: string; remote?: string };

export interface StoreWizardFlowProps {
  /** Callback when wizard completes */
  onComplete: (result: StoreWizardResult) => void;
}

type WizardStep = "choose" | "join-url" | "create-alias" | "create-remote";

/**
 * StoreWizardFlow - Complete wizard flow for store onboarding
 *
 * Orchestrates the multi-step wizard:
 * 1. Choose: Skip / Join / Create
 * 2. Join path: Enter remote URL
 * 3. Create path: Enter alias, then optional remote
 */
export function StoreWizardFlow({ onComplete }: StoreWizardFlowProps) {
  const [step, setStep] = useState<WizardStep>("choose");
  const [joinUrl, setJoinUrl] = useState("");
  const [createAlias, setCreateAlias] = useState("team");
  const [createRemote, setCreateRemote] = useState<string | undefined>();

  const handleChoice = useCallback((choice: "skip" | "join" | "create") => {
    if (choice === "skip") {
      onComplete({ action: "skip" });
    } else if (choice === "join") {
      setStep("join-url");
    } else {
      setStep("create-alias");
    }
  }, [onComplete]);

  const handleJoinUrl = useCallback((url: string) => {
    if (url.trim().length === 0) {
      // Cancelled - go back to choice
      setStep("choose");
    } else {
      onComplete({ action: "join", url: url.trim() });
    }
  }, [onComplete]);

  const handleCreateAlias = useCallback((alias: string) => {
    if (alias.trim().length === 0) {
      // Cancelled - go back to choice
      setStep("choose");
    } else {
      setCreateAlias(alias.trim());
      setStep("create-remote");
    }
  }, []);

  const handleCreateRemote = useCallback((remote: string) => {
    if (remote.trim().length > 0) {
      onComplete({ action: "create", alias: createAlias, remote: remote.trim() });
    } else {
      onComplete({ action: "create", alias: createAlias });
    }
  }, [onComplete, createAlias]);

  switch (step) {
    case "choose":
      return (
        <StoreWizard
          onSelect={handleChoice}
          title="Set up a team / shared knowledge store for this project?"
        />
      );

    case "join-url":
      return (
        <InputField
          message="Shared store git remote (URL):"
          placeholder="git@github.com:org/knowledge.git"
          onSubmit={handleJoinUrl}
          onCancel={() => setStep("choose")}
        />
      );

    case "create-alias":
      return (
        <InputField
          message="Local alias for the new store:"
          initialValue="team"
          onSubmit={handleCreateAlias}
          onCancel={() => setStep("choose")}
        />
      );

    case "create-remote":
      return (
        <InputField
          message="Git remote to back it (leave blank to skip):"
          placeholder="git@github.com:org/knowledge.git"
          onSubmit={handleCreateRemote}
          onCancel={() => onComplete({ action: "create", alias: createAlias })}
          optional
        />
      );

    default:
      return null;
  }
}

/**
 * Run the store wizard and return the result
 *
 * This function renders the wizard and waits for user input.
 * Returns a promise that resolves when the wizard completes.
 */
export function runStoreWizard(): Promise<StoreWizardResult> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <StoreWizardFlow onComplete={(result) => {
        unmount();
        resolve(result);
      }} />
    );
  });
}
