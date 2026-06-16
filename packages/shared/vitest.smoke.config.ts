import { defaultExclude, defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

// windows-smoke contract-surface config. Inherits the base config (include,
// raised testTimeout/hookTimeout) and drops the tests that are NOT part of the
// cross-platform contract the Windows job exists to guard:
//   - store/recall-perf      perf gate with Linux-calibrated p95 thresholds
//   - resolver/test-wall     heavy POSIX git-roundtrip harness
//   - store/migrate-two-layer imports a shebang'd .mjs migration script that
//                            vite's Windows transform rejects ("Invalid token");
//                            the full migration matrix runs on Linux only.
// Excludes live in this JS array (not a CLI --exclude flag) so they are immune
// to cmd.exe vs POSIX shell quoting differences on the Windows runner.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [
        ...defaultExclude,
        "**/store/recall-perf.test.ts",
        "**/resolver/test-wall.test.ts",
        "**/store/migrate-two-layer.test.ts",
      ],
    },
  }),
);
