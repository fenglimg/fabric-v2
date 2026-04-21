import { afterEach, describe, expect, it, vi } from "vitest";

type MockFetch = ReturnType<typeof vi.fn>;

function setMockWindow(url: string) {
  const current = new URL(url);
  const replaceState = vi.fn((_state: unknown, _title: string, nextUrl: string) => {
    const resolved = new URL(nextUrl, current.origin);
    current.href = resolved.href;
    current.pathname = resolved.pathname;
    current.search = resolved.search;
    current.hash = resolved.hash;
  });

  const windowObject = {
    location: current,
    history: { replaceState },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowObject,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { title: "Fabric Dashboard" },
  });

  return { windowObject, replaceState };
}

function createJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  } as unknown as Response;
}

function createFailedSseResponse(): Response {
  return {
    ok: false,
    body: null,
  } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("dashboard api client", () => {
  it("reuses a URL token for both JSON requests and SSE reconnects", async () => {
    const { replaceState } = setMockWindow("http://127.0.0.1:7373/?token=secret&view=doctor#/rules");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ status: "ok", checks: [], summary: {}, audit: null }))
      .mockResolvedValueOnce(createFailedSseResponse());

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const client = await import("./client.ts");

    await client.getDoctor();
    client.openSseConnection("/events", null, () => {}, () => {}, () => {});
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
      },
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Accept: "text/event-stream",
        Authorization: "Bearer secret",
      },
    });
    expect(replaceState).toHaveBeenCalledWith({}, "Fabric Dashboard", "/?view=doctor#/rules");
  });

  it("notifies the caller exactly once when SSE setup fails", async () => {
    setMockWindow("http://127.0.0.1:7373/#/rules");
    const fetchMock: MockFetch = vi.fn().mockResolvedValue(createFailedSseResponse());

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const client = await import("./client.ts");
    const onClose = vi.fn();

    client.openSseConnection("/events", null, () => {}, () => {}, onClose);
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
