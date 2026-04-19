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

export interface HumanLockEntry {
  file: string;
  start_line: number;
  end_line: number;
  hash: string;
}
