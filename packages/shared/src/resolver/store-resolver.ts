import type {
  StoreReadSet,
  StoreResolveInput,
  StoreResolver,
  StoreResolverWarning,
  WriteTarget,
} from "./contracts.js";
import { ResolverNotImplementedError } from "./project-root-resolver.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.5 — StoreResolver TDD STUB.
//
// Red-suite scaffold mirroring project-root-resolver.ts. The factory satisfies
// the StoreResolver contract so resolver/read-set.golden.test.ts compiles; each
// method throws until P0.6 implements read-set (required_stores ∪ implicit
// personal, S11/S54), write-target layering (S60), alias→UUID (S55), and
// missing/local-only warnings (S51/R5#5) against resolver/golden/read-set.golden.json.
// ---------------------------------------------------------------------------

export function createStoreResolver(): StoreResolver {
  return {
    resolveReadSet(input: StoreResolveInput): StoreReadSet {
      void input;
      throw new ResolverNotImplementedError("StoreResolver.resolveReadSet");
    },
    resolveWriteTarget(
      input: StoreResolveInput,
      scope: string,
    ): { target: WriteTarget | null; warnings: StoreResolverWarning[] } {
      void input;
      void scope;
      throw new ResolverNotImplementedError("StoreResolver.resolveWriteTarget");
    },
    aliasToUuid(input: StoreResolveInput, alias: string): string | undefined {
      void input;
      void alias;
      throw new ResolverNotImplementedError("StoreResolver.aliasToUuid");
    },
  };
}
