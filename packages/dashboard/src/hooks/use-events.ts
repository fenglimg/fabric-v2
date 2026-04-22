import { signal } from "@preact/signals-core";
import type { FabricEvent } from "@fenglimg/fabric-shared";
import { useEffect, useRef, useState } from "preact/hooks";

import { openSseConnection, parseFabricEvent } from "../api/client";

const eventTypes: FabricEvent["type"][] = [
  "meta:updated",
  "lock:drift",
  "lock:approved",
  "ledger:appended",
  "drift:detected",
];

const eventTypeSet = new Set<string>(eventTypes);

export const fabricEventsSignal = signal<FabricEvent[]>([]);
export const fabricConnectedSignal = signal(false);
export const fabricEventVersionSignal = signal(0);

export type UseEventsState = {
  connected: boolean;
  lastEvent: FabricEvent | null;
  version: number;
};

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

export function useEvents(): UseEventsState {
  const [state, setState] = useState<UseEventsState>({
    connected: fabricConnectedSignal.value,
    lastEvent: fabricEventsSignal.value[0] ?? null,
    version: fabricEventVersionSignal.value,
  });

  const lastEventIdRef = useRef<string | null>(null);
  const backoffRef = useRef<number>(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const setConnected = (connected: boolean) => {
      fabricConnectedSignal.value = connected;
      setState((current) => ({ ...current, connected }));
    };

    const handleEvent = (type: string, data: string, id: string) => {
      if (!eventTypeSet.has(type)) {
        return;
      }

      if (id.length > 0) {
        lastEventIdRef.current = id;
      }

      const event = parseFabricEvent(data);
      if (event === null) {
        return;
      }

      fabricEventsSignal.value = [event, ...fabricEventsSignal.value].slice(0, 50);
      fabricEventVersionSignal.value += 1;
      setState({
        connected: fabricConnectedSignal.value,
        lastEvent: event,
        version: fabricEventVersionSignal.value,
      });
    };

    let currentConnection: ReturnType<typeof openSseConnection> | null = null;

    const connect = () => {
      if (!mountedRef.current) {
        return;
      }

      currentConnection = openSseConnection(
        "/events",
        lastEventIdRef.current,
        handleEvent,
        () => {
          if (mountedRef.current) {
            backoffRef.current = BACKOFF_INITIAL_MS;
            setConnected(true);
          }
        },
        () => {
          if (!mountedRef.current) {
            return;
          }

          setConnected(false);

          const delay = backoffRef.current;
          backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
          reconnectTimerRef.current = setTimeout(connect, delay);
        },
      );
    };

    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      currentConnection?.close();
      setConnected(false);
    };
  }, []);

  return state;
}
