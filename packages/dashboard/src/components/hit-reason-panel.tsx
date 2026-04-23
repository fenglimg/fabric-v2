import type { AgentsActivationTier, AgentsMeta } from "@fenglimg/fabric-shared";

import type { RulesContextPayload } from "../api/client";
import { useI18n } from "../i18n/use-i18n";

export type HitReasonItem = {
  file: string;
  layer: "L1" | "L2" | "description";
  tier: AgentsActivationTier;
  scope: string;
  description: string | null;
};

export function HitReasonPanel({
  meta,
  rulesContext,
}: {
  meta: AgentsMeta | null;
  rulesContext: RulesContextPayload | null;
}) {
  const { t } = useI18n();
  const items = buildHitReasonItems(meta, rulesContext);

  return (
    <section className="topology-card">
      <div className="topology-card-head">
        <div>
          <h3>{t("dashboard.rule-topology.hit-reason.title")}</h3>
          <p className="muted">{t("dashboard.rule-topology.hit-reason.subtitle")}</p>
        </div>
        <span className="badge badge-level">{t("dashboard.rule-topology.hit-reason.count", { count: String(items.length) })}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-card">{t("dashboard.rule-topology.hit-reason.empty")}</div>
      ) : (
        <div className="reason-list" role="list" aria-label={t("dashboard.rule-topology.hit-reason.aria-label")}>
          {items.map((item) => (
            <article key={`${item.layer}:${item.file}:${item.tier}`} className="reason-card" role="listitem">
              <div className="reason-card-head">
                <strong>{item.file}</strong>
                <span className={`badge reason-tier reason-tier-${item.tier}`}>
                  {t(`dashboard.rule-topology.hit-reason.tier.${item.tier}`)}
                </span>
              </div>
              <div className="reason-card-meta">
                <span>{item.layer}</span>
                <span>{item.tier === "always" ? t("dashboard.rule-topology.hit-reason.global") : item.scope}</span>
              </div>
              {item.description !== null && item.description.length > 0 ? (
                <p className="reason-description">{item.description}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function buildHitReasonItems(
  meta: AgentsMeta | null,
  rulesContext: RulesContextPayload | null,
): HitReasonItem[] {
  if (meta === null || rulesContext === null) {
    return [];
  }

  const nodesByFile = new Map(
    Object.values(meta.nodes).map((node) => [node.file, node] as const),
  );
  const items: HitReasonItem[] = [];
  const seen = new Set<string>();

  for (const entry of rulesContext.L1) {
    pushRuleItem(items, seen, nodesByFile, entry.path, "L1");
  }

  for (const entry of rulesContext.L2) {
    pushRuleItem(items, seen, nodesByFile, entry.path, "L2");
  }

  for (const stub of rulesContext.description_stubs ?? []) {
    const key = `description:${stub.path}`;
    if (seen.has(key)) {
      continue;
    }

    const node = nodesByFile.get(stub.path);
    items.push({
      file: stub.path,
      layer: "description",
      tier: "description",
      scope: node?.scope_glob ?? "",
      description: stub.description,
    });
    seen.add(key);
  }

  return items.sort((left, right) => left.file.localeCompare(right.file));
}

function pushRuleItem(
  items: HitReasonItem[],
  seen: Set<string>,
  nodesByFile: Map<string, AgentsMeta["nodes"][string]>,
  file: string,
  layer: "L1" | "L2",
): void {
  const key = `${layer}:${file}`;
  if (seen.has(key)) {
    return;
  }

  const node = nodesByFile.get(file);
  const tier = node?.activation?.tier ?? "path";

  items.push({
    file,
    layer,
    tier,
    scope: node?.scope_glob ?? "",
    description: tier === "description" ? node?.activation?.description ?? null : null,
  });
  seen.add(key);
}
