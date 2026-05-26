#!/usr/bin/env bash
# rc.35 W6 dogfood — real upgrade of werewolf project from rc.30 → rc.35.
# Validates the 5 P0 paths the lite-plan promised to repair.
#
# USAGE:
#   1. Set WEREWOLF_REPO to the absolute path of the werewolf project.
#   2. Set FABRIC_REPO to the absolute path of THIS repo (pcf).
#   3. Run:  bash dogfood-script.sh
#
# IMPORTANT: this script does NOT modify the werewolf repo's tracked files,
# it only re-runs `fabric install` and observes outputs. Evidence is captured
# under .workflow/.scratchpad/rc35-closure/evidence/.

set -u  # -e omitted because we want to keep capturing evidence even when a step fails
set -o pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
FABRIC_REPO="${FABRIC_REPO:-/Users/wepie/Desktop/personal-projects/pcf}"
WEREWOLF_REPO="${WEREWOLF_REPO:-/Users/wepie/Desktop/personal-projects/werewolf-minigame}"

EVIDENCE_DIR="${FABRIC_REPO}/.workflow/.scratchpad/rc35-closure/evidence"
mkdir -p "${EVIDENCE_DIR}"

log() { printf "[dogfood] %s\n" "$*" | tee -a "${EVIDENCE_DIR}/_summary.log"; }
section() { printf "\n========== %s ==========\n" "$*" | tee -a "${EVIDENCE_DIR}/_summary.log"; }

if [ ! -d "${WEREWOLF_REPO}" ]; then
  log "ERROR: werewolf repo not found at ${WEREWOLF_REPO}"
  log "       Set WEREWOLF_REPO env var and re-run."
  exit 1
fi

# ---------------------------------------------------------------------------
# PHASE 1 — Build + pack fabric-cli locally
# ---------------------------------------------------------------------------
section "PHASE 1 — Build + pack rc.35 locally"
cd "${FABRIC_REPO}"
pnpm -r build 2>&1 | tee "${EVIDENCE_DIR}/01-build.log" | tail -5

# Pack the CLI tarball so we can `npm install -g` it without publishing
cd "${FABRIC_REPO}/packages/cli"
PACK_FILE=$(npm pack 2>&1 | tail -1)
PACK_ABS="${FABRIC_REPO}/packages/cli/${PACK_FILE}"
log "Packed CLI to ${PACK_ABS}"

# ---------------------------------------------------------------------------
# PHASE 2 — Capture rc.30 baseline (BEFORE upgrade)
# ---------------------------------------------------------------------------
section "PHASE 2 — rc.30 baseline (BEFORE upgrade)"
cd "${WEREWOLF_REPO}"
log "Current global fabric version:"
fabric -v 2>&1 | tee "${EVIDENCE_DIR}/02-before-version.log" || log "(fabric not on PATH)"

log "fabric doctor BEFORE upgrade (expect: ZodError dump from rc.30 schema mismatch):"
fabric doctor 2>&1 | tee "${EVIDENCE_DIR}/02-before-doctor.log" | head -40 || true

# ---------------------------------------------------------------------------
# PHASE 3 — Upgrade global CLI to rc.35
# ---------------------------------------------------------------------------
section "PHASE 3 — Upgrade global CLI rc.30 → rc.35"
npm install -g "${PACK_ABS}" 2>&1 | tee "${EVIDENCE_DIR}/03-npm-install.log" | tail -5

log "New global fabric version:"
fabric -v 2>&1 | tee "${EVIDENCE_DIR}/03-after-version.log"

# ---------------------------------------------------------------------------
# PHASE 4 — Re-run fabric install (full) to sync hooks + skills
# ---------------------------------------------------------------------------
section "PHASE 4 — fabric install (full) in werewolf"
cd "${WEREWOLF_REPO}"
fabric install --yes 2>&1 | tee "${EVIDENCE_DIR}/04-install.log" | tail -30

# ---------------------------------------------------------------------------
# PHASE 5 — Validate P0-9 (hooks wired, schema parses, no JSON dump)
# ---------------------------------------------------------------------------
section "PHASE 5 — fabric doctor AFTER upgrade (P0-9 / P0-14 acceptance)"
fabric doctor 2>&1 | tee "${EVIDENCE_DIR}/05-after-doctor.log"
log "ACCEPTANCE CHECKS:"
log "  (a) doctor output does NOT contain raw zod JSON dump:"
if grep -q '"code":"' "${EVIDENCE_DIR}/05-after-doctor.log"; then
  log "      ✗ FAIL — raw JSON dump still present"
else
  log "      ✓ PASS"
fi
log "  (b) hooks_wired check passes:"
if grep -q 'Claude Code hooks wired.*ok\|hooks_wired.*ok' "${EVIDENCE_DIR}/05-after-doctor.log"; then
  log "      ✓ PASS"
else
  log "      ? CHECK MANUALLY in 05-after-doctor.log"
fi
log "  (c) global_cli_outdated does NOT fire:"
if grep -q 'global_cli_outdated' "${EVIDENCE_DIR}/05-after-doctor.log"; then
  log "      ✗ FAIL — lint still fires after upgrade"
else
  log "      ✓ PASS"
fi

# ---------------------------------------------------------------------------
# PHASE 6 — Validate TASK-08 --force-skills-only
# ---------------------------------------------------------------------------
section "PHASE 6 — fabric install --force-skills-only (TASK-08)"
# Snapshot settings.json before
cp "${WEREWOLF_REPO}/.claude/settings.json" "${EVIDENCE_DIR}/06-settings-before.json" 2>/dev/null || true

fabric install --force-skills-only 2>&1 | tee "${EVIDENCE_DIR}/06-skills-only.log"

# Settings should be byte-identical
if [ -f "${EVIDENCE_DIR}/06-settings-before.json" ]; then
  if diff -q "${EVIDENCE_DIR}/06-settings-before.json" "${WEREWOLF_REPO}/.claude/settings.json" > /dev/null 2>&1; then
    log "  ✓ PASS — .claude/settings.json unchanged"
  else
    log "  ✗ FAIL — .claude/settings.json changed (should NOT for --force-skills-only)"
  fi
fi

# ---------------------------------------------------------------------------
# PHASE 7 — Validate TASK-07 (events.jsonl edit_intent_checked from hook)
# ---------------------------------------------------------------------------
section "PHASE 7 — TASK-07 hook → events.jsonl (run after a real edit session)"
log "Manual step: open Claude Code on werewolf, edit any file, exit."
log "Then run:  jq -r 'select(.event_type == \"edit_intent_checked\" and .ledger_source == \"hook\")' .fabric/events.jsonl | head -3"
log "Expected: at least 1 line per Edit/Write fire."

# ---------------------------------------------------------------------------
# PHASE 8 — Summary
# ---------------------------------------------------------------------------
section "SUMMARY"
log "Evidence captured under: ${EVIDENCE_DIR}"
log "Review _summary.log + per-phase logs and decide ship/no-ship."
