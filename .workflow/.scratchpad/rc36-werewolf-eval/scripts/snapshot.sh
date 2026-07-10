#!/bin/bash
# rc.36 werewolf-minigame eval — snapshot werewolf .fabric/ + ~/.fabric/ before audit
set -e
SNAP="/Users/wepie/Desktop/personal-projects/pcf/.workflow/.scratchpad/rc36-werewolf-eval/evidence"
WEREWOLF=~/Desktop/projects/werewolf-minigame

mkdir -p "$SNAP"

echo "[snapshot] werewolf HEAD"
( cd "$WEREWOLF" && git rev-parse HEAD > "$SNAP/werewolf-head.txt" )
echo "[snapshot] werewolf working tree status"
( cd "$WEREWOLF" && git status --short > "$SNAP/werewolf-status-pre.txt" )

echo "[snapshot] werewolf .fabric/ → tar"
( cd "$WEREWOLF" && tar czf "$SNAP/werewolf-fabric-pre.tar.gz" .fabric )

echo "[snapshot] ~/.fabric/ → tar"
( cd ~ && tar czf "$SNAP/home-fabric-pre.tar.gz" .fabric 2>/dev/null || true )

echo "[snapshot] werewolf filelist"
( cd "$WEREWOLF" && find .fabric -type f | sort > "$SNAP/werewolf-filelist-pre.txt" )

echo "[snapshot] global fab/fabric version"
which fab > "$SNAP/global-fab-which.txt" 2>/dev/null
fab --version > "$SNAP/global-fab-version.txt" 2>/dev/null
node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js --version > "$SNAP/pcf-cli-version.txt"

echo "[done] snapshot 完成,evidence: $SNAP"
ls -la "$SNAP"
