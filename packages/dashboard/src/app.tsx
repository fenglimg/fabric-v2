import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { useEvents } from "./hooks/use-events";
import { I18nProvider } from "./i18n/provider";
import { useI18n } from "./i18n/use-i18n";
import { DoctorView } from "./views/doctor";
import { HistoryReplayView } from "./views/history-replay";
import { IntentTimelineView } from "./views/intent-timeline";
import { RuleTopologyView } from "./views/rule-topology";
import { RulesTreeView } from "./views/rules-tree";

declare const __DASHBOARD_VERSION__: string;

type Route = "readiness" | "rules-explain" | "timeline" | "health";

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

  const coreRoutes = [
    {
      id: "readiness" as const,
      hash: "#/readiness",
      label: t("dashboard.app.nav.readiness.label-bilingual"),
      subtitle: t("dashboard.app.nav.readiness.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.readiness"),
    },
    {
      id: "rules-explain" as const,
      hash: "#/rules-explain",
      label: t("dashboard.app.nav.rules-explain.label-bilingual"),
      subtitle: t("dashboard.app.nav.rules-explain.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.rules-explain"),
    },
    {
      id: "timeline" as const,
      hash: "#/timeline",
      label: t("dashboard.app.nav.timeline.label-bilingual"),
      subtitle: t("dashboard.app.nav.timeline.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.timeline"),
    },
    {
      id: "health" as const,
      hash: "#/health",
      label: t("dashboard.app.nav.health.label-bilingual"),
      subtitle: t("dashboard.app.nav.health.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.health"),
    },
  ];

  useEffect(() => {
    const handleHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", handleHashChange);
    if (window.location.hash === "" || window.location.hash === "#/topology" || window.location.hash === "#/rules") {
      window.location.hash = "#/rules-explain";
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const activeRoute = useMemo(
    () => coreRoutes.find((item) => item.id === route) ?? coreRoutes[1],
    [coreRoutes, route],
  );

  return (
    <AppShell connected={events.connected} port={readPort()} activeRoute={activeRoute.id}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">F</span>
          <span>fabric</span>
          <span className="brand-version">{`v${__DASHBOARD_VERSION__}`}</span>
        </div>
        <div className="nav-section">{t("dashboard.app.nav.section.insights")}</div>
        <nav aria-label={t("dashboard.app.nav.aria-label")}>
          {coreRoutes.map((item) => (
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
        <span className="nav-item muted-nav"><span className="dot" />{t("dashboard.app.nav.modules.read-only")}</span>
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
        {route === "readiness" ? <ModulePlaceholder title={t("dashboard.app.nav.readiness.label")} subtitle={t("dashboard.app.nav.readiness.subtitle")} /> : null}
        {route === "rules-explain" ? (
          <>
            <RuleTopologyView lastEvent={events.lastEvent} />
            <RulesTreeView lastEvent={events.lastEvent} />
          </>
        ) : null}
        {route === "timeline" ? (
          <>
            <IntentTimelineView lastEvent={events.lastEvent} />
            <HistoryReplayView lastEvent={events.lastEvent} />
          </>
        ) : null}
        {route === "health" ? <DoctorView lastEvent={events.lastEvent} /> : null}
      </main>
      <div className="live-region" aria-live="polite" aria-atomic="true">
        {events.lastEvent === null ? "" : t("dashboard.app.live-region.received", { type: events.lastEvent.type })}
      </div>
    </AppShell>
  );
}

function ModulePlaceholder({ title, subtitle }: { title: string; subtitle: string }) {
  const { t } = useI18n();

  return (
    <section className="view">
      <div className="view-header">
        <div>
          <h1 className="view-title">{title}</h1>
          <p className="view-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="empty-card module-placeholder">
        <strong>{t("dashboard.module-placeholder.coming-soon")}</strong>
        <p>{t("dashboard.module-placeholder.read-only")}</p>
      </div>
    </section>
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
    case "#/readiness":
      return "readiness";
    case "#/rules-explain":
      return "rules-explain";
    case "#/timeline":
      return "timeline";
    case "#/health":
      return "health";
    default:
      return "rules-explain";
  }
}

function readPort(): number {
  const parsed = Number.parseInt(window.location.port, 10);
  return Number.isFinite(parsed) ? parsed : 7373;
}
