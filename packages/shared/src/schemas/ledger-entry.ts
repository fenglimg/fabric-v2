import { z } from "zod";

export interface AiLedgerEntry {
  id?: string;
  ts: number;
  source: "ai";
  commit_sha?: string;
  intent: string;
  affected_paths: string[];
}

export interface HumanLedgerEntry {
  id?: string;
  ts: number;
  source: "human";
  parent_sha: string;
  parent_ledger_entry_id?: string;
  intent: string;
  affected_paths: string[];
  diff_stat: string;
  annotation?: string;
}

export type LedgerEntry = AiLedgerEntry | HumanLedgerEntry;

const ledgerEntryBaseSchema = {
  id: z.string().optional(),
  ts: z.number().int().nonnegative(),
  intent: z.string(),
  affected_paths: z.array(z.string()),
};

export const aiLedgerEntrySchema = z.object({
  ...ledgerEntryBaseSchema,
  source: z.literal("ai"),
  commit_sha: z.string().optional(),
});

export const humanLedgerEntrySchema = z.object({
  ...ledgerEntryBaseSchema,
  source: z.literal("human"),
  parent_sha: z.string(),
  parent_ledger_entry_id: z.string().optional(),
  diff_stat: z.string(),
  annotation: z.string().optional(),
});

const ledgerEntryUnionSchema = z.discriminatedUnion("source", [aiLedgerEntrySchema, humanLedgerEntrySchema]);

export const ledgerEntrySchema = z.preprocess((value) => {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (!("source" in value) || (value as { source?: unknown }).source === undefined)
  ) {
    return {
      ...(value as Record<string, unknown>),
      source: "human",
    };
  }

  return value;
}, ledgerEntryUnionSchema);
