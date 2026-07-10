#!/bin/bash
# Restore werewolf .fabric + ~/.fabric/ from pre-snapshot
# Usage: bash restore.sh
set -e
SNAP="/Users/wepie/Desktop/personal-projects/pcf/.workflow/.scratchpad/rc34-werewolf-eval/evidence"
WEREWOLF=~/Desktop/projects/werewolf-minigame

echo "[restore] werewolf .fabric/"
rm -rf "$WEREWOLF/.fabric"
tar xzf "$SNAP/werewolf-fabric-pre.tar.gz" -C "$WEREWOLF"

echo "[restore] ~/.fabric/"
rm -rf ~/.fabric
tar xzf "$SNAP/home-fabric-pre.tar.gz" -C ~/

echo "[forensic diff]"
( cd "$WEREWOLF" && find .fabric -type f | sort > "$SNAP/werewolf-filelist-post.txt" )
diff "$SNAP/werewolf-filelist-pre.txt" "$SNAP/werewolf-filelist-post.txt" && echo "OK: filelist identical" || echo "WARN: filelist drift"
