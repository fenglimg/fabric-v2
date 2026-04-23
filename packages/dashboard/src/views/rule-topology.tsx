import type { AgentsMeta, FabricEvent } from "@fenglimg/fabric-shared";
import { useEffect, useMemo, useState } from "preact/hooks";

import { getRules, getRulesContext, type RulesContextPayload } from "../api/client";
import { CoverageHeatmap, DriftIndicator, HitReasonPanel } from "../components";
import { useI18n } from "../i18n/use-i18n";
import { ViewHeader } from "./rules-tree";

export type RuleTopologyViewProps = {
  lastEvent: FabricEvent | null;
};

export const DEFAULT_RULES_CONTEXT_PATH = "packages/dashboard/src/views/rule-topology.tsx";

export function RuleTopologyView({ lastEvent }: RuleTopologyViewProps) {
  const { t } = useI18n();
  const [meta, setMeta] = useState<AgentsMeta | null>(null);
  const [rulesContext, setRulesContext] = useState<RulesContextPayload | null>(null);
  const [pathInput, setPathInput] = useState(DEFAULT_RULES_CONTEXT_PATH);
  const [activePath, setActivePath] = useState(DEFAULT_RULES_CONTEXT_PATH);
  const [error, setError] = useState<string | null>(null);

  const load = async (path: string) => {
    try {
      const [nextMeta, nextContext] = await Promise.all([
        getRules(),
        getRulesContext(path),
      ]);
      setMeta(nextMeta);
      setRulesContext(nextContext);
      setActivePath(path);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load(DEFAULT_RULES_CONTEXT_PATH);
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "meta:updated" || lastEvent?.type === "drift:detected" || lastEvent?.type === "lock:drift") {
      void load(activePath);
    }
  }, [activePath, lastEvent]);

  const nodes = useMemo(() => meta === null ? [] : Object.values(meta.nodes), [meta]);
  const hitCount = (rulesContext?.L1.length ?? 0) + (rulesContext?.L2.length ?? 0) + (rulesContext?.description_stubs?.length ?? 0);

  return (
    <section className="view">
      <ViewHeader
        title={t("dashboard.rule-topology.title")}
        subtitle={t("dashboard.rule-topology.subtitle")}
      />
      {error !== null ? <DriftIndicator kind="banner" severity="stale" message={error} /> : null}
      <div className="tree-filter topology-toolbar">
        <input
          value={pathInput}
          onInput={(event) => setPathInput(event.currentTarget.value)}
          placeholder={t("dashboard.rule-topology.path.placeholder")}
          aria-label={t("dashboard.rule-topology.path.aria-label")}
        />
        <button
          className="ghost-button"
          type="button"
          onClick={() => void load(pathInput.trim().length > 0 ? pathInput.trim() : DEFAULT_RULES_CONTEXT_PATH)}
        >
          {t("dashboard.shared.refresh")}
        </button>
      </div>
      <div className="status-line topology-status">
        <span>{t("dashboard.rule-topology.status.sample", { path: activePath })}</span>
        <span>{t("dashboard.rule-topology.status.hits", { count: String(hitCount) })}</span>
        <span>{meta === null ? t("dashboard.shared.loading") : t("dashboard.rule-topology.status.revision", { revision: meta.revision })}</span>
      </div>
      <div className="view-split topology-split">
        <CoverageHeatmap nodes={nodes} />
        <HitReasonPanel meta={meta} rulesContext={rulesContext} />
      </div>
    </section>
  );
}
