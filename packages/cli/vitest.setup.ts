// Hermetic locale + global-config isolation for the entire CLI test suite.
//
// Two host-environment leaks made ~14 tests fail on dev machines while passing
// on CI (and would flip on a zh-CN CI runner):
//   1. resolveGlobalRoot() = FABRIC_HOME ?? homedir(), so the developer's real
//      ~/.fabric/fabric-global.json (language: "zh-CN") leaked into tests that
//      did not isolate FABRIC_HOME.
//   2. detectNodeLocale() falls back to $LANG, so a host with LANG=zh_CN.UTF-8
//      rendered Chinese even when the test expected English.
//
// Pinning both here makes the suite deterministic across machines. Tests that
// exercise a specific locale or a populated global config override FAB_LANG /
// FABRIC_HOME themselves (and restore to these defaults in afterEach).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FAB_LANG = "en";

// A fresh empty global root PER TEST FILE (setupFiles run once per file). This
// isolates files from each other: a global `fabric install` in one file cannot
// leak stores/config into another's resolveGlobalRoot(). Tests that need a
// populated global config set their own FABRIC_HOME in beforeEach.
process.env.FABRIC_HOME = mkdtempSync(join(tmpdir(), "fabric-cli-test-home-"));
