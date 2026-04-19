import { z } from "zod";

export const ledgerSourceSchema = z.enum(["ai", "human"]);

const timestampFilterSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return undefined;
    }

    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}, z.number().int().nonnegative());

export const ledgerQuerySchema = z.object({
  source: ledgerSourceSchema.optional(),
  since: timestampFilterSchema.optional(),
});

export const historyStateQuerySchema = z.object({
  ledger_id: z.string().trim().min(1).optional(),
  ts: timestampFilterSchema.optional(),
}).superRefine((value, ctx) => {
  const provided = [value.ledger_id, value.ts].filter((entry) => entry !== undefined);

  if (provided.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of ledger_id or ts.",
      path: ["ledger_id"],
    });
  }
});

export const humanLockApproveRequestSchema = z.object({
  file: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  new_hash: z.string().min(1),
});

export const humanLockFileParamsSchema = z.object({
  file: z.string().min(1),
});

export const annotateIntentRequestSchema = z.object({
  ledger_entry_id: z.string().min(1),
  annotation: z.string().trim().min(1),
});
