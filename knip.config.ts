import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignore: [
    'scripts/**',
    // Workflow orchestration scratch (.maestro session ledgers, issue
    // discoveries, generator helpers). Never imported by shipped TS sources —
    // knip --strict otherwise flags artifacts like discoveries/*/_generate.cjs
    // as unused files (W4-10 / ISS-019).
    '.workflow/**',
    // Dogfooded Fabric Stop-hook scripts installed by `fabric install` into this
    // repo's own .claude / .codex client configs. They are runtime hooks
    // invoked externally by Claude Code / Codex CLI — never imported by TS
    // sources, so knip --strict reports them as unused.
    '.claude/hooks/**',
    '.codex/hooks/**',
    '.cursor/hooks/**'
  ],
  // Workspace cross-dependencies and build-tool deps are flagged as "unused" by --strict
  // because knip v6 does not resolve workspace: protocol packages as external deps in strict
  // mode, and Vite plugin deps (tailwindcss, autoprefixer, postcss) are config-only.
  // TODO: review during 1.8.x patch when knip workspace resolution matures.
  ignoreDependencies: [
    '@fenglimg/fabric-shared',
    '@fenglimg/fabric-server',
    '@fenglimg/fabric-dashboard',
    // CLI: dynamic import().then() chains not followed by knip --strict for dep tracking.
    '@clack/prompts',
    'picocolors',
    'string-width',
    'tree-sitter-typescript',
    // Server: used inside services but missed via workspace dep chain under --strict.
    'express',
    'chokidar',
    'minimatch',
    // Dashboard: signals-core used via preact/signals; vite plugins are config-only.
    '@preact/signals-core',
    'autoprefixer',
    'postcss',
    'tailwindcss'
  ],
  ignoreBinaries: [
    // tsc invoked in .github/workflows/ci.yml; it is a devDep of each workspace package.
    'tsc'
  ],
  // Internal server implementation details and CLI citty command patterns that
  // knip flags as unused/duplicate but are intentional. W4-10 (ISS-020): pruned
  // 8 stale entries whose files were deleted (http.ts, audit-log.ts,
  // get-rules.ts, rule-sections.ts, bootstrap.ts, hooks.ts, scan.ts, serve.ts).
  ignoreIssues: {
    // server/cache.ts: cache types are internal; class is unexported but types remain.
    'packages/server/src/cache.ts': ['exports', 'types'],
    // server/config-loader.ts: readFabricConfig is package-private helper.
    'packages/server/src/config-loader.ts': ['exports'],
    // server/meta-reader.ts: schema shapes and error classes are server-internal.
    'packages/server/src/meta-reader.ts': ['exports', 'types'],
    // server/services: internal implementation files — exports are package-private helpers.
    'packages/server/src/services/_shared.ts': ['exports', 'duplicates'],
    'packages/server/src/services/doctor.ts': ['exports', 'types'],
    'packages/server/src/services/event-ledger.ts': ['types'],
    'packages/server/src/services/plan-context.ts': ['types'],
    'packages/server/src/services/read-ledger.ts': ['exports', 'types'],
    'packages/server/src/services/rehydrate-state.ts': ['exports'],
    // CLI commands: citty pattern exports both named const and `export default`.
    // Both forms are intentional (named for potential programmatic use, default for citty).
    'packages/cli/src/commands/config.ts': ['duplicates'],
    'packages/cli/src/commands/doctor.ts': ['duplicates'],
    'packages/cli/src/commands/install.ts': ['duplicates']
  },
  workspaces: {
    'packages/cli': {
      entry: [
        'src/index.ts',
        'src/commands/**/*.ts',
        'src/config/**/*.ts',
        'src/scanner/**/*.ts',
        'src/bootstrap-guide.ts',
        'src/dev-mode.ts',
        'src/colors.ts',
        'src/i18n.ts'
      ],
      project: ['src/**/*.ts'],
      ignore: ['src/**/__tests__/**', 'templates/**']
    },
    'packages/server': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
      ignore: ['src/**/__tests__/**']
    },
    'packages/shared': {
      entry: [
        'src/index.ts',
        'src/i18n/index.ts',
        'src/types/index.ts',
        'src/node.ts',
        'src/node/atomic-write.ts',
        'src/node/mcp-payload-guard.ts',
        'src/errors/index.ts',
        'src/schemas/api-contracts.ts'
      ],
      project: ['src/**/*.ts'],
      ignore: ['src/**/__tests__/**', 'src/**/*.test.ts']
    },
    'packages/dashboard': {
      entry: [
        'src/main.tsx',
        'src/app.tsx',
        'src/components/**/*.{ts,tsx}',
        'src/views/**/*.{ts,tsx}',
        'src/hooks/**/*.ts',
        'src/api/**/*.ts',
        'src/i18n/**/*.{ts,tsx}'
      ],
      project: ['src/**/*.{ts,tsx}'],
      ignore: ['src/**/*.test.{ts,tsx}']
    }
  }
}

export default config
