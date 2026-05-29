// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Install transaction core (plan / apply / verify / rollback
// + receipt). Surfaces: S1 (install-receipt) · S28 · S36 (error recovery).
//
// A generic, side-effect-at-the-edges transaction runner: each step carries an
// `apply` and a `rollback`. Steps run in order; if any `apply` throws, the
// already-applied steps are rolled back in REVERSE order and the receipt records
// exactly what happened. This is the testable spine `fabric install` wires its
// concrete steps (write config / register MCP / install skills+hooks / git
// init+push) into, so a half-finished install never leaves a corrupt state
// (clean rollback) and the receipt is the audit trail for recovery (S36).
// ---------------------------------------------------------------------------

export interface TransactionStep {
  name: string;
  apply: () => void | Promise<void>;
  // Compensating action; only invoked for steps that successfully applied.
  rollback: () => void | Promise<void>;
}

export type StepStatus = "applied" | "rolled_back" | "rollback_failed" | "failed" | "skipped";

export interface ReceiptStep {
  name: string;
  status: StepStatus;
  error?: string;
}

export interface InstallReceipt {
  ok: boolean;
  steps: ReceiptStep[];
  // Present when the transaction failed: the step whose apply threw.
  failedStep?: string;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Run the steps as an all-or-nothing transaction. On the first apply failure,
// roll back applied steps in reverse and return a receipt with ok=false. A
// rollback that itself throws is recorded as `rollback_failed` (loud in the
// receipt) but does not stop the remaining rollbacks.
export async function runInstallTransaction(
  steps: TransactionStep[],
): Promise<InstallReceipt> {
  const receipt: InstallReceipt = { ok: true, steps: [] };
  const applied: TransactionStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      await step.apply();
      applied.push(step);
      receipt.steps.push({ name: step.name, status: "applied" });
    } catch (error) {
      receipt.ok = false;
      receipt.failedStep = step.name;
      receipt.error = errorMessage(error);
      receipt.steps.push({ name: step.name, status: "failed", error: errorMessage(error) });
      // Mark not-yet-reached steps as skipped (deterministic full receipt).
      for (let j = i + 1; j < steps.length; j++) {
        receipt.steps.push({ name: steps[j].name, status: "skipped" });
      }
      // Roll back applied steps in reverse.
      for (const done of [...applied].reverse()) {
        const entry = receipt.steps.find((s) => s.name === done.name);
        try {
          await done.rollback();
          if (entry !== undefined) {
            entry.status = "rolled_back";
          }
        } catch (rollbackError) {
          if (entry !== undefined) {
            entry.status = "rollback_failed";
            entry.error = errorMessage(rollbackError);
          }
        }
      }
      return receipt;
    }
  }

  return receipt;
}
