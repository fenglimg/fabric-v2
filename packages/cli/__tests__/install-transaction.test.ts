import { describe, expect, it } from "vitest";

import {
  runInstallTransaction,
  type TransactionStep,
} from "../src/install/transaction.js";

// v2.1.0-rc.1 P3 — install transaction core tests (S1/S28/S36): success path
// applies all steps; a mid-transaction failure rolls back applied steps in
// reverse and the receipt records exactly what happened.

describe("P3 install transaction", () => {
  it("applies all steps and reports ok on the success path", async () => {
    const order: string[] = [];
    const steps: TransactionStep[] = [
      { name: "config", apply: () => void order.push("a:config"), rollback: () => void order.push("r:config") },
      { name: "mcp", apply: () => void order.push("a:mcp"), rollback: () => void order.push("r:mcp") },
    ];
    const receipt = await runInstallTransaction(steps);
    expect(receipt.ok).toBe(true);
    expect(receipt.steps.map((s) => s.status)).toEqual(["applied", "applied"]);
    expect(order).toEqual(["a:config", "a:mcp"]); // no rollbacks
  });

  it("rolls back applied steps in reverse on a mid-transaction failure", async () => {
    const order: string[] = [];
    const steps: TransactionStep[] = [
      { name: "config", apply: () => void order.push("a:config"), rollback: () => void order.push("r:config") },
      { name: "mcp", apply: () => void order.push("a:mcp"), rollback: () => void order.push("r:mcp") },
      {
        name: "skills",
        apply: () => {
          order.push("a:skills");
          throw new Error("disk full");
        },
        rollback: () => void order.push("r:skills"),
      },
      { name: "hooks", apply: () => void order.push("a:hooks"), rollback: () => void order.push("r:hooks") },
    ];

    const receipt = await runInstallTransaction(steps);

    expect(receipt.ok).toBe(false);
    expect(receipt.failedStep).toBe("skills");
    expect(receipt.error).toBe("disk full");
    // config + mcp applied; skills failed; hooks never reached; rollback reverse.
    expect(order).toEqual(["a:config", "a:mcp", "a:skills", "r:mcp", "r:config"]);
    const byName = new Map(receipt.steps.map((s) => [s.name, s.status]));
    expect(byName.get("config")).toBe("rolled_back");
    expect(byName.get("mcp")).toBe("rolled_back");
    expect(byName.get("skills")).toBe("failed");
    expect(byName.get("hooks")).toBe("skipped");
  });

  it("records rollback_failed without aborting the remaining rollbacks", async () => {
    const order: string[] = [];
    const steps: TransactionStep[] = [
      { name: "config", apply: () => void order.push("a:config"), rollback: () => void order.push("r:config") },
      {
        name: "mcp",
        apply: () => void order.push("a:mcp"),
        rollback: () => {
          throw new Error("rollback boom");
        },
      },
      {
        name: "skills",
        apply: () => {
          throw new Error("apply boom");
        },
        rollback: () => void order.push("r:skills"),
      },
    ];

    const receipt = await runInstallTransaction(steps);
    expect(receipt.ok).toBe(false);
    const byName = new Map(receipt.steps.map((s) => [s.name, s.status]));
    expect(byName.get("mcp")).toBe("rollback_failed");
    // config's rollback still ran after mcp's rollback threw.
    expect(order).toContain("r:config");
  });
});
