import type {
  AgentsMeta,
  FabricEvent,
  LedgerEntry,
} from "@fenglimg/fabric-shared";

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

export type RulesContextEntry = {
  path: string;
  content: string;
};

export type RulesDescriptionStub = {
  path: string;
  description: string;
};

export type RulesHumanLockedNearby = {
  file: string;
  excerpt: string;
};

export type RulesContextPayload = {
  L0: string;
  L1: RulesContextEntry[];
  L2: RulesContextEntry[];
  human_locked_nearby: RulesHumanLockedNearby[];
  description_stubs?: RulesDescriptionStub[];
};

export type DoctorStatus = "ok" | "warn" | "error";

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
};

export type DoctorIssue = {
  code: string;
  name: string;
  message: string;
  path?: string;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
  fixable_errors: DoctorIssue[];
  manual_errors: DoctorIssue[];
  warnings: DoctorIssue[];
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
    metaRevision: string | null;
    computedMetaRevision: string | null;
    ruleCount: number;
    eventLedgerPath: string;
    fixableErrorCount: number;
    manualErrorCount: number;
    warningCount: number;
    targetFiles: Record<string, boolean>;
  };
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

export async function getRulesContext(path: string): Promise<RulesContextPayload> {
  const params = new URLSearchParams();
  params.set("path", path);
  return await getJson<RulesContextPayload>(withQuery("/api/rules/context", params));
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

export type SseEventHandler = (type: string, data: string, id: string) => void;
export type SseCloseHandler = () => void;

export type SseConnection = {
  close: () => void;
};

let cachedAuthToken: string | null | undefined;

export function openSseConnection(
  path: string,
  lastEventId: string | null,
  onEvent: SseEventHandler,
  onOpen: () => void,
  onClose: SseCloseHandler,
): SseConnection {
  let closed = false;
  const controller = new AbortController();
  let closeNotified = false;
  const headers = buildAuthHeaders({ Accept: "text/event-stream" });

  if (lastEventId !== null && lastEventId.length > 0) {
    headers["Last-Event-ID"] = lastEventId;
  }

  void (async () => {
    try {
      const response = await fetch(path, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok || response.body === null) {
        notifyCloseOnce(() => {
          onClose();
        });
        return;
      }

      onOpen();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buf += decoder.decode(value, { stream: true });
        buf = buf.replace(/\r\n/g, "\n");

        let boundary: number;
        while ((boundary = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, boundary);
          buf = buf.slice(boundary + 2);
          parseSseBlock(block, onEvent);
        }
      }
    } catch {
      // intentionally swallowed — caller handles reconnect via onClose
    } finally {
      if (!closed) {
        notifyCloseOnce(() => {
          onClose();
        });
      }
    }
  })();

  return {
    close() {
      closed = true;
      controller.abort();
    },
  };

  function notifyCloseOnce(fn: () => void): void {
    if (closeNotified) {
      return;
    }

    closeNotified = true;
    fn();
  }
}

function parseSseBlock(block: string, onEvent: SseEventHandler): void {
  let type = "message";
  let data = "";
  let id = "";

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data = data.length > 0 ? `${data}\n${line.slice(5).trim()}` : line.slice(5).trim();
    } else if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    }
  }

  if (data.length > 0) {
    onEvent(type, data, id);
  }
}

function readAuthToken(): string | null {
  if (cachedAuthToken !== undefined) {
    return cachedAuthToken;
  }

  const w = window as unknown as Record<string, unknown>;
  const injected = w["__FABRIC_AUTH_TOKEN__"];
  if (typeof injected === "string" && injected.length > 0) {
    cachedAuthToken = injected;
    return cachedAuthToken;
  }

  const currentUrl = new URL(window.location.href);
  const params = currentUrl.searchParams;
  const token = params.get("token");
  if (token !== null && token.length > 0) {
    params.delete("token");
    const nextSearch = params.toString();
    const nextUrl = `${currentUrl.pathname}${nextSearch.length > 0 ? `?${nextSearch}` : ""}${currentUrl.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
    cachedAuthToken = token;
    return cachedAuthToken;
  }

  cachedAuthToken = null;
  return cachedAuthToken;
}

/** @deprecated Use openSseConnection instead */
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
    headers: buildAuthHeaders({ Accept: "application/json" }),
  });

  return await readJsonResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: buildAuthHeaders({
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
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

function buildAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const token = readAuthToken();
  if (token === null) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}
