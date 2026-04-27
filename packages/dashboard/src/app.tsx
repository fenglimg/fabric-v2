import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { useEvents } from "./hooks/use-events";
import { I18nProvider } from "./i18n/provider";
import { useI18n } from "./i18n/use-i18n";
import { ReadinessView } from "./views/readiness";
import { RulesExplainView } from "./views/rules-explain";
import { TimelineView } from "./views/timeline";
import { HealthView } from "./views/health";

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
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("fabric-theme");
    if (saved === "light" || saved === "dark") return saved;
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const events = useEvents();

  // Sync theme to DOM and storage
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("fabric-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const coreRoutes = [
    {
      id: "readiness" as const,
      hash: "#/readiness",
      label: t("dashboard.app.nav.readiness.label"),
      subtitle: t("dashboard.app.nav.readiness.subtitle"),
      icon: (
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      ),
    },
    {
      id: "rules-explain" as const,
      hash: "#/rules-explain",
      label: t("dashboard.app.nav.rules-explain.label"),
      subtitle: t("dashboard.app.nav.rules-explain.subtitle"),
      icon: (
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
      ),
    },
    {
      id: "timeline" as const,
      hash: "#/timeline",
      label: t("dashboard.app.nav.timeline.label"),
      subtitle: t("dashboard.app.nav.timeline.subtitle"),
      icon: (
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      ),
    },
    {
      id: "health" as const,
      hash: "#/health",
      label: t("dashboard.app.nav.health.label"),
      subtitle: t("dashboard.app.nav.health.subtitle"),
      icon: (
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
      ),
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
    <div class="h-screen w-screen flex overflow-hidden antialiased bg-light-bg text-light-text dark:bg-dark-bg dark:text-dark-text selection:bg-brand-accent/30 relative p-0 sm:p-4 gap-4">
      {/* Ambient Background (Only visible in Dark Mode) */}
      <div class="ambient-blob bg-purple-600 w-[500px] h-[500px] top-[-20%] left-[-10%] transition-opacity duration-500 opacity-0 dark:opacity-30"></div>
      <div class="ambient-blob bg-brand-accent w-[500px] h-[500px] bottom-[-20%] right-[10%] transition-opacity duration-500 opacity-0 dark:opacity-30"></div>

      {/* Sidebar Navigation */}
      <aside class="w-64 hidden md:flex flex-col overflow-hidden bg-light-surface border-r border-light-border sm:border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] z-20">
        <div class="p-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-accent to-purple-600 flex items-center justify-center font-bold text-white shadow-md dark:shadow-[0_0_12px_rgba(59,130,246,0.3)]">F</div>
              <span class="font-semibold text-light-text dark:text-dark-text">Fabric <span class="text-light-muted dark:text-dark-muted font-normal">v{__DASHBOARD_VERSION__}</span></span>
            </div>
          </div>
        </div>

        <nav class="flex-1 px-4 space-y-1.5 mt-2">
          <div class="text-[10px] font-bold text-light-muted dark:text-dark-muted uppercase tracking-widest mb-3 px-3">{t("dashboard.app.nav.section.insights")}</div>
          {coreRoutes.map((item) => {
            const isActive = item.id === route;
            return (
              <a
                key={item.id}
                href={item.hash}
                aria-current={isActive ? "page" : undefined}
                class={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200 ${
                  isActive 
                    ? "bg-brand-accent/10 text-brand-accent border border-brand-accent/20 dark:bg-white/15 dark:text-white dark:border-white/20 dark:shadow-[0_0_12px_rgba(255,255,255,0.05)]"
                    : "text-light-muted hover:bg-light-border/50 hover:text-light-text dark:text-dark-muted dark:hover:bg-white/5 dark:hover:text-dark-text"
                }`}
              >
                {item.icon}
                {item.label}
              </a>
            );
          })}
        </nav>

        <div class="p-4 border-t border-light-border dark:border-dark-border mx-4 mb-4 mt-auto rounded-xl bg-light-border/30 dark:bg-black/20">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class={`w-2 h-2 rounded-full ${events.connected ? 'bg-green-500 shadow-[0_0_8px_#22c55e] animate-pulse' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`}></div>
              <span class="text-[10px] font-bold text-light-muted dark:text-dark-muted font-mono uppercase">
                {events.connected ? t("dashboard.app.header.connected") : t("dashboard.app.header.connecting")}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main class="flex-1 flex flex-col gap-4 min-w-0 z-10">
        <header class="h-16 flex items-center justify-between px-6 shrink-0 bg-light-surface border-b border-light-border sm:border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-white/5 dark:backdrop-blur-3xl dark:shadow-xl">
          <div>
            <h1 class="text-lg font-semibold">{activeRoute.label}</h1>
            <p class="text-xs text-light-muted dark:text-dark-muted font-mono mt-0.5">{activeRoute.subtitle}</p>
          </div>

          <div class="flex items-center gap-4">
            <button 
              onClick={toggleTheme}
              class="p-2 rounded-lg bg-light-border/50 hover:bg-light-border text-light-text dark:bg-white/10 dark:hover:bg-white/20 dark:text-dark-text transition-all duration-200 shadow-sm cursor-pointer"
              title="Toggle Theme"
            >
              {theme === "dark" ? (
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
          </div>
        </header>

        <div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
          {route === "readiness" ? <ReadinessView /> : null}
          {route === "rules-explain" ? <RulesExplainView lastEvent={events.lastEvent} /> : null}
          {route === "timeline" ? <TimelineView lastEvent={events.lastEvent} /> : null}
          {route === "health" ? <HealthView lastEvent={events.lastEvent} connected={events.connected} /> : null}
        </div>
      </main>
      
      <div class="sr-only" aria-live="polite" aria-atomic="true">
        {events.lastEvent === null ? "" : t("dashboard.app.live-region.received", { type: events.lastEvent.type })}
      </div>
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
