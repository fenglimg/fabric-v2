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
    <section class="flex flex-col bg-light-surface border border-light-border sm:rounded-2xl sm:shadow-sm dark:bg-dark-surface dark:border-dark-border dark:shadow-xl overflow-hidden min-h-[280px]">
      <div class="p-4 border-b border-light-border dark:border-dark-border flex justify-between items-start bg-light-surface/90 dark:bg-transparent shrink-0">
        <div>
          <h3 class="text-sm font-bold text-light-text dark:text-dark-text m-0">{t("dashboard.rule-topology.hit-reason.title")}</h3>
          <p class="text-xs text-light-muted dark:text-dark-muted mt-1">{t("dashboard.rule-topology.hit-reason.subtitle")}</p>
        </div>
        <span class="text-[10px] font-mono bg-light-border/50 dark:bg-white/10 px-2 py-0.5 rounded-full border border-light-border dark:border-dark-border whitespace-nowrap">
          {t("dashboard.rule-topology.hit-reason.count", { count: String(items.length) })}
        </span>
      </div>
      
      {items.length === 0 ? (
        <div class="p-8 flex-1 flex items-center justify-center text-sm text-light-muted dark:text-dark-muted">
          {t("dashboard.rule-topology.hit-reason.empty")}
        </div>
      ) : (
        <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3" role="list" aria-label={t("dashboard.rule-topology.hit-reason.aria-label")}>
          {items.map((item) => (
            <article key={`${item.layer}:${item.file}:${item.tier}`} class="p-4 rounded-xl border bg-light-bg/50 border-light-border dark:bg-black/20 dark:border-dark-border flex flex-col" role="listitem">
              <div class="flex justify-between items-center gap-2 mb-2">
                <strong class="font-mono text-sm text-light-text dark:text-dark-text truncate">{item.file}</strong>
                <span class={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${getTierClass(item.tier)}`}>
                  {t(`dashboard.rule-topology.hit-reason.tier.${item.tier}`)}
                </span>
              </div>
              <div class="flex justify-between items-center gap-2 text-xs font-mono text-light-muted dark:text-dark-muted">
                <span>{item.layer}</span>
                <span class="truncate">{item.tier === "always" ? t("dashboard.rule-topology.hit-reason.global") : item.scope}</span>
              </div>
              {item.description !== null && item.description.length > 0 ? (
                <p class="text-sm text-light-text dark:text-dark-muted mt-3 leading-relaxed border-t border-light-border dark:border-dark-border pt-3">
                  {item.description}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function getTierClass(tier: AgentsActivationTier): string {
  switch(tier) {
    case "always": return "bg-green-500/10 text-green-600 border border-green-500/30 dark:bg-green-500/20 dark:text-green-400";
    case "path": return "bg-amber-500/10 text-amber-600 border border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400";
    case "description": return "bg-slate-500/10 text-slate-600 border border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-400";
    default: return "bg-light-border/50 text-light-muted dark:bg-white/10 dark:text-dark-muted";
  }
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