import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { useEvents } from "./hooks/use-events";
import { I18nProvider } from "./i18n/provider";
import { useI18n } from "./i18n/use-i18n";
import { DoctorView } from "./views/doctor";
import { HistoryReplayView } from "./views/history-replay";
import { HumanLockView } from "./views/human-lock";
import { IntentTimelineView } from "./views/intent-timeline";
import { RulesTreeView } from "./views/rules-tree";

declare const __DASHBOARD_VERSION__: string;

type Route = "rules" | "locks" | "timeline" | "history" | "doctor";

export function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

function AppContent() {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(readRoute());
  const events = useEvents();
  const routes = [
    {
      id: "rules" as const,
      hash: "#/rules",
      label: t("dashboard.app.nav.rules.label-bilingual"),
      subtitle: t("dashboard.app.nav.rules.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.rules"),
    },
    {
      id: "locks" as const,
      hash: "#/locks",
      label: t("dashboard.app.nav.locks.label-bilingual"),
      subtitle: t("dashboard.app.nav.locks.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.locks"),
    },
    {
      id: "timeline" as const,
      hash: "#/timeline",
      label: t("dashboard.app.nav.timeline.label-bilingual"),
      subtitle: t("dashboard.app.nav.timeline.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.timeline"),
    },
    {
      id: "history" as const,
      hash: "#/history",
      label: t("dashboard.app.nav.history.label-bilingual"),
      subtitle: t("dashboard.app.nav.history.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.history"),
    },
    {
      id: "doctor" as const,
      hash: "#/doctor",
      label: t("dashboard.app.nav.doctor.label-bilingual"),
      subtitle: t("dashboard.app.nav.doctor.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.doctor"),
    },
  ];

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
    <AppShell connected={events.connected} port={readPort()} activeRoute={activeRoute.id}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">F</span>
          <span>fabric</span>
          <span className="brand-version">{`v${__DASHBOARD_VERSION__}`}</span>
        </div>
        <nav aria-label={t("dashboard.app.nav.aria-label")}>
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
        <div className="nav-section">{t("dashboard.app.nav.section.diagnostics")}</div>
        <span className="nav-item muted-nav"><span className="dot" />{t("dashboard.app.nav.drift-check")}</span>
      </aside>
      <main className="main">
        <header className="header">
          <div className="breadcrumb">
            <span>{window.location.pathname === "/" ? "~" : window.location.pathname}</span>
            <span className="sep">/</span>
            <strong>{activeRoute.breadcrumb}</strong>
          </div>
          <div className="header-actions">
            <span className={`badge-live ${events.connected ? "connected" : "disconnected"}`}>
              <span className="pulse" aria-hidden="true" />
              {events.connected ? t("dashboard.app.header.connected") : t("dashboard.app.header.connecting")}
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
        {events.lastEvent === null ? "" : t("dashboard.app.live-region.received", { type: events.lastEvent.type })}
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
