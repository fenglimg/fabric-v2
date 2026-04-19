import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { useEvents } from "./hooks/use-events";
import { DoctorView } from "./views/doctor";
import { HistoryReplayView } from "./views/history-replay";
import { HumanLockView } from "./views/human-lock";
import { IntentTimelineView } from "./views/intent-timeline";
import { RulesTreeView } from "./views/rules-tree";

type Route = "rules" | "locks" | "timeline" | "history" | "doctor";

const routes: { id: Route; hash: string; label: string; subtitle: string }[] = [
  { id: "rules", hash: "#/rules", label: "Rules Tree", subtitle: "meta graph" },
  { id: "locks", hash: "#/locks", label: "Human Lock", subtitle: "protected regions" },
  { id: "timeline", hash: "#/timeline", label: "Intent Timeline", subtitle: "ledger stream" },
  { id: "history", hash: "#/history", label: "History Replay", subtitle: "time travel" },
  { id: "doctor", hash: "#/doctor", label: "Doctor", subtitle: "fab diagnostics" },
];

export function App() {
  const [route, setRoute] = useState<Route>(readRoute());
  const events = useEvents();

  useEffect(() => {
    const handleHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", handleHashChange);
    if (window.location.hash === "") {
      window.location.hash = "#/rules";
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const activeRoute = useMemo(() => routes.find((item) => item.id === route) ?? routes[0], [route]);

  return (
    <AppShell connected={events.connected} port={readPort()} activeRoute={activeRoute.label}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">F</span>
          <span>fabric</span>
          <span className="brand-version">v1.1</span>
        </div>
        <nav aria-label="Dashboard views">
          {routes.map((item) => (
            <a
              key={item.id}
              className={`nav-item ${item.id === route ? "active" : ""}`}
              href={item.hash}
              aria-current={item.id === route ? "page" : undefined}
            >
              <span className="dot" aria-hidden="true" />
              <span>{item.label}</span>
              <small>{item.subtitle}</small>
            </a>
          ))}
        </nav>
        <div className="nav-section">Diagnostics</div>
        <span className="nav-item muted-nav"><span className="dot" />Drift Check</span>
      </aside>
      <main className="main">
        <header className="header">
          <div className="breadcrumb">
            <span>{window.location.pathname === "/" ? "~" : window.location.pathname}</span>
            <span className="sep">/</span>
            <strong>{activeRoute.label.toLowerCase().replaceAll(" ", "-")}</strong>
          </div>
          <div className="header-actions">
            <span className={`badge-live ${events.connected ? "connected" : "disconnected"}`}>
              <span className="pulse" aria-hidden="true" />
              {events.connected ? "CONNECTED" : "CONNECTING"}
            </span>
            <span className="port-label">:{readPort()} /events</span>
          </div>
        </header>
        {route === "rules" ? <RulesTreeView lastEvent={events.lastEvent} /> : null}
        {route === "locks" ? <HumanLockView lastEvent={events.lastEvent} /> : null}
        {route === "timeline" ? <IntentTimelineView lastEvent={events.lastEvent} /> : null}
        {route === "history" ? <HistoryReplayView lastEvent={events.lastEvent} /> : null}
        {route === "doctor" ? <DoctorView lastEvent={events.lastEvent} /> : null}
      </main>
      <div className="live-region" aria-live="polite" aria-atomic="true">
        {events.lastEvent === null ? "" : `Received ${events.lastEvent.type}`}
      </div>
    </AppShell>
  );
}

function AppShell({
  connected,
  port,
  activeRoute,
  children,
}: {
  connected: boolean;
  port: number;
  activeRoute: string;
  children: ComponentChildren;
}) {
  return (
    <div className={`app-shell ${connected ? "is-connected" : "is-disconnected"}`} data-port={port} data-route={activeRoute}>
      {children}
    </div>
  );
}

function readRoute(): Route {
  switch (window.location.hash) {
    case "#/locks":
      return "locks";
    case "#/timeline":
      return "timeline";
    case "#/history":
      return "history";
    case "#/doctor":
      return "doctor";
    case "#/rules":
    default:
      return "rules";
  }
}

function readPort(): number {
  const parsed = Number.parseInt(window.location.port, 10);
  return Number.isFinite(parsed) ? parsed : 7373;
}
