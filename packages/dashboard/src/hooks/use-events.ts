import { signal } from "@preact/signals-core";
import type { FabricEvent } from "@fenglimg/fabric-shared";
import { useEffect, useState } from "preact/hooks";

import { getEvents, parseFabricEvent } from "../api/client";

const eventTypes: FabricEvent["type"][] = [
  "meta:updated",
  "lock:drift",
  "lock:approved",
  "ledger:appended",
  "drift:detected",
];

export const fabricEventsSignal = signal<FabricEvent[]>([]);
export const fabricConnectedSignal = signal(false);
export const fabricEventVersionSignal = signal(0);

export type UseEventsState = {
  connected: boolean;
  lastEvent: FabricEvent | null;
  version: number;
};

export function useEvents(): UseEventsState {
  const [state, setState] = useState<UseEventsState>({
    connected: fabricConnectedSignal.value,
    lastEvent: fabricEventsSignal.value[0] ?? null,
    version: fabricEventVersionSignal.value,
  });

  useEffect(() => {
    const source = getEvents();

    const setConnected = (connected: boolean) => {
      fabricConnectedSignal.value = connected;
      setState((current) => ({ ...current, connected }));
    };

    const handleEvent = (message: MessageEvent<string>) => {
      const event = parseFabricEvent(message.data);
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

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    for (const type of eventTypes) {
      source.addEventListener(type, handleEvent as EventListener);
    }

    return () => {
      for (const type of eventTypes) {
        source.removeEventListener(type, handleEvent as EventListener);
      }
      source.close();
      setConnected(false);
    };
  }, []);

  return state;
}
