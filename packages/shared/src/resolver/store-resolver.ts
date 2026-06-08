import { isPersonalScope } from "../schemas/scope.js";
import type {
  ReadSetEntry,
  StoreReadSet,
  StoreResolveInput,
  StoreResolver,
  StoreResolverWarning,
  WriteTarget,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.6 — StoreResolver implementation (pure; no fs/git).
//
//   resolveReadSet     — required_stores ∪ implicit personal (S11/S54). Each
//                        unmatched required store → missing_store warning (S51,
//                        NOT a silent drop); each mounted-but-remoteless shared
//                        store → local_only_no_remote nudge (R5#5). Personal is
//                        always last and never triggers the local-only nudge.
//   resolveWriteTarget — personal scope → personal store (R5#3); else the active
//                        write store (S60). No writable store → null + warning.
//   aliasToUuid        — alias → store UUID (S55).
//
// Inputs arrive already validated by storeResolveInputSchema, so `writable` /
// `personal` defaults are materialized on every mounted store.
// ---------------------------------------------------------------------------

function findPersonal(input: StoreResolveInput) {
  return input.mountedStores.find((s) => s.personal);
}

function personalEntry(input: StoreResolveInput): ReadSetEntry | undefined {
  const p = findPersonal(input);
  if (p === undefined) {
    return undefined;
  }
  const entry: ReadSetEntry = { store_uuid: p.store_uuid, alias: p.alias, writable: p.writable };
  if (p.remote !== undefined) {
    entry.remote = p.remote;
  }
  return entry;
}

function routeMatches(routeScope: string, scope: string): boolean {
  return scope === routeScope || scope.startsWith(`${routeScope}:`);
}

function resolveRouteAlias(input: StoreResolveInput, scope: string): string | undefined {
  const routes = input.writeRoutes ?? [];
  const exact = routes.find((route) => route.scope === scope);
  if (exact !== undefined) {
    return exact.store;
  }
  const prefix = routes
    .filter((route) => routeMatches(route.scope, scope))
    .sort((a, b) => b.scope.length - a.scope.length)[0];
  return prefix?.store ?? input.defaultWriteAlias ?? input.activeWriteAlias;
}

export function createStoreResolver(): StoreResolver {
  return {
    resolveReadSet(input: StoreResolveInput): StoreReadSet {
      const stores: ReadSetEntry[] = [];
      const warnings: StoreResolverWarning[] = [];

      for (const req of input.requiredStores) {
        const matched = input.mountedStores.find(
          (m) => !m.personal && (m.alias === req.id || m.store_uuid === req.id),
        );
        if (matched === undefined) {
          const suffix =
            req.suggested_remote === undefined
              ? ""
              : ` (suggested remote: ${req.suggested_remote})`;
          warnings.push({
            code: "missing_store",
            ref: req.id,
            message: `required store '${req.id}' is not mounted; run \`fabric store add\`${suffix}`,
          });
          continue;
        }
        const entry: ReadSetEntry = {
          store_uuid: matched.store_uuid,
          alias: matched.alias,
          writable: matched.writable,
        };
        if (matched.remote !== undefined) {
          entry.remote = matched.remote;
        } else {
          warnings.push({
            code: "local_only_no_remote",
            ref: matched.alias,
            message: `store '${matched.alias}' is local-only; add a git remote to back it up (\`fabric store ... \` / doctor nudge)`,
          });
        }
        stores.push(entry);
      }

      const personal = personalEntry(input);
      if (personal !== undefined) {
        stores.push(personal);
      }

      return { stores, warnings };
    },

    resolveWriteTarget(
      input: StoreResolveInput,
      scope: string,
    ): { target: WriteTarget | null; warnings: StoreResolverWarning[] } {
      if (isPersonalScope(scope)) {
        const p = findPersonal(input);
        if (p === undefined) {
          return {
            target: null,
            warnings: [
              {
                code: "missing_store",
                ref: "personal",
                message: "no personal store is mounted; run `fabric install --global` first",
              },
            ],
          };
        }
        return { target: { store_uuid: p.store_uuid, alias: p.alias }, warnings: [] };
      }

      const routeAlias = resolveRouteAlias(input, scope);
      const active =
        routeAlias === undefined
          ? undefined
          : input.mountedStores.find(
              (m) => m.writable && !m.personal && (m.alias === routeAlias || m.store_uuid === routeAlias),
            );
      if (active === undefined) {
        return {
          target: null,
          warnings: [
            {
              code: "alias_unresolved",
              ref: routeAlias ?? scope,
              message: `no writable store for scope '${scope}'; set a write route or default write store`,
            },
          ],
        };
      }
      return { target: { store_uuid: active.store_uuid, alias: active.alias }, warnings: [] };
    },

    aliasToUuid(input: StoreResolveInput, alias: string): string | undefined {
      return input.mountedStores.find((m) => m.alias === alias)?.store_uuid;
    },
  };
}
