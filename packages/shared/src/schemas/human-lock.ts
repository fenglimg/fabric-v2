import { z } from "zod";

export interface HumanLockEntry {
  file: string;
  start_line: number;
  end_line: number;
  hash: string;
}

export interface HumanLockFile {
  locked?: HumanLockEntry[];
}

export const humanLockEntrySchema = z.object({
  file: z.string(),
  start_line: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  hash: z.string(),
});

export const humanLockFileSchema = z.object({
  locked: z.array(humanLockEntrySchema).optional(),
});
