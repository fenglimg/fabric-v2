import { RuleError } from "@fenglimg/fabric-shared/errors";

export class HumanLockEntryNotFoundError extends RuleError {
  readonly code = "HUMAN_LOCK_ENTRY_NOT_FOUND";

  constructor(id: string, opts?: { actionHint?: string }) {
    super(`Cannot find human lock entry: ${id}`, {
      actionHint: opts?.actionHint ?? "Verify the human lock entry ID exists in the current ledger",
    });
  }
}
