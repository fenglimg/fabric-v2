// Type surface for the one-shot single-layer → two-layer store migration script.
// The script itself stays plain .mjs (it is run directly with `node`, never
// built); this declaration exists so the regression test in
// packages/shared/test/store/migrate-two-layer.test.ts can import it without
// falling back to `any`. Keep in sync with `migrateTwoLayer`'s destructured
// parameter list and its three `return` statements.

export interface MigrateTwoLayerOptions {
  globalRoot: string;
  deriveMountLabel: (store: { store_uuid: string; mount_name?: string; personal?: boolean }) => string;
  storeMountSubPath: (store: { store_uuid: string; mount_name?: string; personal?: boolean }) => string;
  storesRootDir: string;
  /** Write a timestamped copy of fabric-global.json before mutating. Default true. */
  backup?: boolean;
  log?: (message: string) => void;
}

export interface MigrateTwoLayerResult {
  /** Aliases actually moved into the two-layer layout. */
  migrated: string[];
  /** Aliases left in place, each with the reason it was skipped. */
  skipped: Array<{ alias: string; reason: string }>;
  /** Path of the config backup, or null when `backup:false` / nothing to migrate. */
  backup: string | null;
}

export function migrateTwoLayer(options: MigrateTwoLayerOptions): MigrateTwoLayerResult;
