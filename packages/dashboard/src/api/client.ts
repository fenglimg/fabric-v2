import type {
  AgentsMeta,
  FabricEvent,
  HumanLockEntry,
  LedgerEntry,
} from "@fenglimg/fabric-shared";

export type HumanLockStatus = HumanLockEntry & {
  drift: boolean;
  current_hash: string;
};

export type ApproveHumanLockBody = {
  file: string;
  start_line: number;
  end_line: number;
  new_hash: string;
};

export type AnnotateIntentBody = {
  ledger_entry_id: string;
  annotation: string;
};

export type ScanReport = {
  target: string;
  framework: {
    kind: string;
    version: string;
    subkind: string;
    evidence: string[];
  };
  readmeQuality: string;
  hasContributing: boolean;
  fileCount: number;
  ignoredCount: number;
  hasExistingFabric: boolean;
  recommendations: string[];
};

export type DoctorStatus = "ok" | "warn" | "error";

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
  summary: {
    target: string;
    framework: {
      kind: string;
      version: string;
      subkind: string;
    };
    entryPoints: Array<{
      path: string;
      reason: string;
    }>;
    driftCount: number;
    protectedPathCount: number;
    protectedPathsIntact: boolean;
    lastLedgerEntryTs: number | null;
    lastLedgerEntryAgeMs: number | null;
    metaRevision: string | null;
  };
};

export type ApproveHumanLockResult = {
  updated: boolean;
  entry: HumanLockStatus;
  ledger_entry?: LedgerEntry;
};

export type AnnotateIntentResult = {
  created: boolean;
  entry: LedgerEntry;
};

export type HistoryReplayMetadata = {
  at_ledger_id: string;
  at_commit: string | null;
  replayed_count: number;
  mode: "git-show" | "ledger-fallback";
};

export type HistoryReplayResult = {
  meta: AgentsMeta;
  metadata: HistoryReplayMetadata;
  entries: LedgerEntry[];
};

type LedgerQuery = {
  source?: "ai" | "human";
  since?: number | string;
};

type HistoryStateQuery = {
  ledgerId?: string;
  ts?: number | string;
};

export async function getRules(): Promise<AgentsMeta> {
  return await getJson<AgentsMeta>("/api/rules");
}

export async function getLedger(query: LedgerQuery = {}): Promise<LedgerEntry[]> {
  const params = new URLSearchParams();
  if (query.source !== undefined) {
    params.set("source", query.source);
  }
  if (query.since !== undefined) {
    params.set("since", String(query.since));
  }

  return await getJson<LedgerEntry[]>(withQuery("/api/ledger", params));
}

export async function getScan(): Promise<ScanReport> {
  return await getJson<ScanReport>("/api/scan");
}

export async function getDoctor(): Promise<DoctorReport> {
  return await getJson<DoctorReport>("/api/doctor");
}

export async function getHumanLock(): Promise<HumanLockStatus[]> {
  return await getJson<HumanLockStatus[]>("/api/human-lock");
}

export async function approveHumanLock(
  body: ApproveHumanLockBody,
): Promise<ApproveHumanLockResult> {
  return await postJson<ApproveHumanLockResult>("/api/human-lock/approve", body);
}

export async function annotateIntent(body: AnnotateIntentBody): Promise<AnnotateIntentResult> {
  return await postJson<AnnotateIntentResult>("/api/intent/annotate", body);
}

export async function getHistoryState(query: HistoryStateQuery): Promise<HistoryReplayResult> {
  const params = new URLSearchParams();
  if (query.ledgerId !== undefined) {
    params.set("ledger_id", query.ledgerId);
  }
  if (query.ts !== undefined) {
    params.set("ts", String(query.ts));
  }

  return await getJson<HistoryReplayResult>(withQuery("/api/history/state", params));
}

export function getEvents(): EventSource {
  return new EventSource("/events");
}

export function parseFabricEvent(raw: string): FabricEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FabricEvent>;
    return typeof parsed.type === "string" && "payload" in parsed ? (parsed as FabricEvent) : null;
  } catch {
    return null;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });

  return await readJsonResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return await readJsonResponse<T>(response);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    throw new Error(readApiError(payload, response.status));
  }

  return payload as T;
}

function readApiError(payload: unknown, status: number): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }

  return `Fabric API request failed with HTTP ${status}.`;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}
