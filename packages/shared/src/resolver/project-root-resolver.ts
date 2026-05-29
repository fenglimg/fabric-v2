import type {
  ProjectRootResolution,
  ProjectRootResolver,
  ProjectRootSignals,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P0.5 — ProjectRootResolver TDD STUB.
//
// This is the red-suite scaffold: the factory exists and satisfies the
// contract type so the golden test-wall (resolver/*.golden.test.ts) COMPILES,
// but `resolve` throws until P0.6 implements the four-signal logic
// (env > ancestor marker > cwd-self marker > repo root — see ADJ-P0-1 and
// resolver/golden/project-root.golden.json). P0.6 replaces the throw and the
// red-suite's `it.fails` markers flip to `it`.
// ---------------------------------------------------------------------------

export class ResolverNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (P0.6 TDD target)`);
    this.name = "ResolverNotImplementedError";
  }
}

export function createProjectRootResolver(): ProjectRootResolver {
  return {
    resolve(signals: ProjectRootSignals): ProjectRootResolution | null {
      void signals;
      throw new ResolverNotImplementedError("ProjectRootResolver.resolve");
    },
  };
}
