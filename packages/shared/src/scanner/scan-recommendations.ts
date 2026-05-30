import type { Translator } from "../i18n/types.js";

// W4-11 (ISS-021): single source of truth for project-scan recommendations.
// Previously forked across cli/scanner/forensic.ts (hardcoded zh-CN) and
// server-http-experimental/api/scan.ts (hardcoded en), drifting and bypassing
// the i18n layer. Both entry points now call this one i18n-keyed builder, so
// the same input yields the same (locale-resolved) recommendation set.
//
// Signals are optional: a `false` actively emits the corresponding setup
// nudge; `undefined` means "the caller does not track this signal" and the
// item is skipped (forensic does not inspect Fabric/CONTRIBUTING presence,
// the http scan does).
export type ScanRecommendationInput = {
  frameworkKind: string;
  hasMeta?: boolean;
  readmeOk?: boolean;
  hasContributing?: boolean;
  hasExistingFabric?: boolean;
};

export function buildScanRecommendations(
  input: ScanRecommendationInput,
  t: Translator,
): string[] {
  const recs: string[] = [];

  // Setup checklist (emitted only when the caller tracked the signal AND it is
  // unmet) — mirrors the former http scan L0 items.
  if (input.hasExistingFabric === false) {
    recs.push(t("scan.rec.install"));
  }
  if (input.readmeOk === false) {
    recs.push(t("scan.rec.readme"));
  }
  if (input.hasContributing === false) {
    recs.push(t("scan.rec.contributing"));
  }

  // Framework-aware interview nudges — the former forensic set.
  switch (input.frameworkKind) {
    case "cocos-creator":
      recs.push(t("scan.rec.cocos.lifecycle"));
      recs.push(t("scan.rec.cocos.human-protect"));
      if (input.hasMeta === true) {
        recs.push(t("scan.rec.cocos.meta-lock"));
      }
      break;
    case "next":
      recs.push(t("scan.rec.next"));
      break;
    case "vite":
      recs.push(t("scan.rec.vite"));
      break;
    case "unknown":
      recs.push(t("scan.rec.unknown"));
      break;
    default:
      recs.push(t("scan.rec.generic", { kind: input.frameworkKind }));
  }

  return recs;
}
