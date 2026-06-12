// Main-line server only needs the read-only legacy serve-lock probe. The
// canonical liveness/read parser lives in shared so quarantined serve-lock and
// doctor cannot drift.
export {
  isAlive,
  readServeLockState as readLockState,
} from "@fenglimg/fabric-shared/node";
