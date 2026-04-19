import { z } from "zod";

import { agentsMetaSchema, type AgentsMeta } from "./agents-meta.js";
import { forensicReportSchema, type ForensicReport } from "./forensic-report.js";
import { humanLockEntrySchema, type HumanLockEntry } from "./human-lock.js";
import { ledgerEntrySchema, type LedgerEntry } from "./ledger-entry.js";

export interface MetaUpdatedEvent {
  type: "meta:updated";
  payload: AgentsMeta;
}

export interface LockDriftEvent {
  type: "lock:drift";
  payload: {
    locked: HumanLockEntry[];
    drifted: HumanLockEntry[];
  };
}

export interface LockApprovedEvent {
  type: "lock:approved";
  payload: {
    locked: HumanLockEntry[];
    approved: HumanLockEntry[];
  };
}

export interface LedgerAppendedEvent {
  type: "ledger:appended";
  payload: LedgerEntry;
}

export interface DriftDetectedEvent {
  type: "drift:detected";
  payload: ForensicReport;
}

export type FabricEvent =
  | MetaUpdatedEvent
  | LockDriftEvent
  | LockApprovedEvent
  | LedgerAppendedEvent
  | DriftDetectedEvent;

export const metaUpdatedEventSchema = z.object({
  type: z.literal("meta:updated"),
  payload: agentsMetaSchema,
});

export const lockDriftEventSchema = z.object({
  type: z.literal("lock:drift"),
  payload: z.object({
    locked: z.array(humanLockEntrySchema),
    drifted: z.array(humanLockEntrySchema),
  }),
});

export const lockApprovedEventSchema = z.object({
  type: z.literal("lock:approved"),
  payload: z.object({
    locked: z.array(humanLockEntrySchema),
    approved: z.array(humanLockEntrySchema),
  }),
});

export const ledgerAppendedEventSchema = z.object({
  type: z.literal("ledger:appended"),
  payload: ledgerEntrySchema,
});

export const driftDetectedEventSchema = z.object({
  type: z.literal("drift:detected"),
  payload: forensicReportSchema,
});

export const fabricEventSchema = z.discriminatedUnion("type", [
  metaUpdatedEventSchema,
  lockDriftEventSchema,
  lockApprovedEventSchema,
  ledgerAppendedEventSchema,
  driftDetectedEventSchema,
]);
