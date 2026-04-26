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

type Route = "topology" | "forensic" | "semantic" | "ledger" | "rules" | "timeline" | "history" | "doctor";

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
  const moduleRoutes = [
    {
      id: "topology" as const,
      hash: "#/topology",
      label: t("dashboard.app.nav.module-a.label-bilingual"),
      subtitle: t("dashboard.app.nav.module-a.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.topology"),
    },
    {
      id: "forensic" as const,
      hash: "#/forensic",
      label: t("dashboard.app.nav.module-b.label-bilingual"),
      subtitle: t("dashboard.app.nav.module-b.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.forensic"),
    },
    {
      id: "semantic" as const,
      hash: "#/semantic",
      label: t("dashboard.app.nav.module-c.label-bilingual"),
      subtitle: t("dashboard.app.nav.module-c.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.semantic"),
    },
    {
      id: "ledger" as const,
      hash: "#/ledger",
      label: t("dashboard.app.nav.module-d.label-bilingual"),
      subtitle: t("dashboard.app.nav.module-d.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.ledger"),
    },
  ];
  const diagnosticRoutes = [
    {
      id: "rules" as const,
      hash: "#/rules",
      label: t("dashboard.app.nav.rules.label-bilingual"),
      subtitle: t("dashboard.app.nav.rules.subtitle"),
      breadcrumb: t("dashboard.app.breadcrumb.rules"),
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
      window.location.hash = "#/topology";
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const activeRoute = useMemo(
    () => [...moduleRoutes, ...diagnosticRoutes].find((item) => item.id === route) ?? moduleRoutes[0],
    [diagnosticRoutes, moduleRoutes, route],
  );

  return (
    <AppShell connected={events.connected} port={readPort()} activeRoute={activeRoute.id}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">F</span>
          <span>fabric</span>
          <span className="brand-version">{`v${__DASHBOARD_VERSION__}`}</span>
        </div>
        <nav aria-label={t("dashboard.app.nav.aria-label")}>
          {moduleRoutes.map((item) => (
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
        <div className="nav-section">{t("dashboard.app.nav.section.modules-status")}</div>
        <span className="nav-item muted-nav"><span className="dot" />{t("dashboard.app.nav.modules.read-only")}</span>
        <div className="nav-section">{t("dashboard.app.nav.section.diagnostics")}</div>
        {diagnosticRoutes.map((item) => (
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
        {route === "topology" ? <RuleTopologyView lastEvent={events.lastEvent} /> : null}
        {route === "forensic" ? <ModulePlaceholder title={t("dashboard.module-placeholder.forensic.title")} subtitle={t("dashboard.module-placeholder.forensic.subtitle")} /> : null}
        {route === "semantic" ? <ModulePlaceholder title={t("dashboard.module-placeholder.semantic.title")} subtitle={t("dashboard.module-placeholder.semantic.subtitle")} /> : null}
        {route === "ledger" ? <ModulePlaceholder title={t("dashboard.module-placeholder.ledger.title")} subtitle={t("dashboard.module-placeholder.ledger.subtitle")} /> : null}
        {route === "rules" ? <RulesTreeView lastEvent={events.lastEvent} /> : null}
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
    case "#/topology":
      return "topology";
    case "#/forensic":
      return "forensic";
    case "#/semantic":
      return "semantic";
    case "#/ledger":
      return "ledger";
    case "#/timeline":
      return "timeline";
    case "#/history":
      return "history";
    case "#/doctor":
      return "doctor";
    case "#/rules":
      return "rules";
    default:
      return "topology";
  }
}

function readPort(): number {
  const parsed = Number.parseInt(window.location.port, 10);
  return Number.isFinite(parsed) ? parsed : 7373;
}
