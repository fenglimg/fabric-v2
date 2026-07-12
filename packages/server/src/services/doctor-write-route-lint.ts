import { loadProjectConfig, type Translator } from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor-types.js";

// ---------------------------------------------------------------------------
// write_route_target_unbound — cross-check that every write_routes[*].store
// resolves against the project's required_stores. Under the "single team slot"
// model (KT-DEC-0049) a project may retain a write_route whose target lives in
// a store no longer bound as a required_store — e.g. the werewolf-minigame
// case where a legacy `team → cocos` route survived the migration to a
// single team slot pointing at `team`. Resolver's write path then reports
// `no write-target store resolved` at fab_propose time; this lint moves that
// failure to `fabric doctor`, before the runtime write is attempted.
//
// Static detection: a route is unbound iff its `.store` matches no entry in
// `required_stores[*].id`. The check is purely config-level (no resolver, no
// global mount state), aligned with KT-DEC-0048 "写时严格 / 读时容旧" — the
// doctor lint is a read-side advisory, not a load-time hard error.
// ---------------------------------------------------------------------------

export interface WriteRouteViolation {
  /** The scope whose route is dangling (e.g. "team", "project:x"). */
  scope: string;
  /** The store alias/uuid the route points at, which is absent from required_stores. */
  store: string;
}

export function detectWriteRouteUnbound(projectRoot: string): WriteRouteViolation[] {
  const config = loadProjectConfig(projectRoot);
  const routes = config?.write_routes ?? [];
  if (!Array.isArray(routes) || routes.length === 0) {
    return [];
  }
  const boundIds = new Set(
    (config?.required_stores ?? [])
      .map((r) => (typeof r?.id === "string" ? r.id : ""))
      .filter((id) => id.length > 0),
  );
  const violations: WriteRouteViolation[] = [];
  for (const route of routes) {
    const scope = typeof route?.scope === "string" ? route.scope : "";
    const store = typeof route?.store === "string" ? route.store : "";
    if (scope.length === 0 || store.length === 0) {
      continue;
    }
    if (!boundIds.has(store)) {
      violations.push({ scope, store });
    }
  }
  return violations;
}

// Roll the detection into a doctor warning. Advisory (never an error / never
// blocks health): the fix is a `fabric store bind <store>` (add to
// required_stores) or removing the stale route from fabric-config.json — both
// user-driven config edits, so no --fix mutation.
export function createWriteRouteUnboundCheck(
  t: Translator,
  violations: WriteRouteViolation[],
): DoctorCheck {
  if (violations.length === 0) {
    return {
      name: t("doctor.check.write_route_target_unbound.name"),
      status: "ok",
      message: t("doctor.check.write_route_target_unbound.ok"),
    };
  }
  const summary = violations
    .map((v) => `${v.scope} → ${v.store}`)
    .join(", ");
  return {
    name: t("doctor.check.write_route_target_unbound.name"),
    status: "warn",
    kind: "warning",
    code: "write_route_target_unbound",
    fixable: false,
    message: t("doctor.check.write_route_target_unbound.message", {
      count: String(violations.length),
      routes: summary,
    }),
    actionHint: t("doctor.check.write_route_target_unbound.remediation"),
  };
}
