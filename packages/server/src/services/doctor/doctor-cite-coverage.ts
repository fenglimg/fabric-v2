// Doctor cite/history domain barrel (W4 split).
// Keeps previous import path `./doctor-cite-coverage.js` stable for doctor.ts / index.ts / tests.

export {
  ensureCitePolicyActivatedMarker,
  ensureCiteContractPolicyActivatedMarker,
} from "./doctor-cite-markers.js";

export {
  computeExposedAndMutated,
  sumFoldedTurnCounters,
  runDoctorCiteCoverage,
} from "./doctor-cite-coverage-core.js";
export type {
  CiteContractMetrics,
  CiteLayerTypeBreakdown,
  CiteCoverageReport,
} from "./doctor-cite-coverage-core.js";

export {
  rollupCiteAuditIfNeeded,
  purgeEmptyShellTurnsIfNeeded,
} from "./doctor-cite-rollup.js";
export type {
  CiteRollupResult,
  EmptyShellPurgeResult,
} from "./doctor-cite-rollup.js";

export {
  runDoctorArchiveHistory,
  runDoctorHistoryAll,
} from "./doctor-history.js";
export type {
  ArchiveHistoryEntry,
  ArchiveHistoryReport,
  HistoryDayRow,
  HistoryAllReport,
} from "./doctor-history.js";
