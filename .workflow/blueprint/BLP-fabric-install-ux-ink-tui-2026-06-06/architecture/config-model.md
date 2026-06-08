# Configurable Fields Model

## Overview

This document defines all configurable fields for the install/uninstall flow with their types, defaults, constraints, and validation rules.

## Field Categories

### 1. CLI Arguments (User Input)

| Field | Type | Default | Source | Required | Constraints |
|-------|------|---------|--------|----------|-------------|
| `--yes` | boolean | false | CLI flag | Optional | N/A |
| `--non-interactive` | boolean | false | CLI flag | Optional | Mutually exclusive with wizard |
| `--store <id>` | string | - | CLI flag | Optional | Must match existing store ID |
| `--create-store <path>` | string | - | CLI flag | Optional | Valid absolute path, must not exist |
| `--connect-store <url>` | string | - | CLI flag | Optional | Valid Git URL (HTTPS or SSH) |
| `--clients <list>` | ClientType[] | auto-detected | CLI flag | Optional | Subset of {claude, cursor, codex} |
| `--hooks <list>` | HookType[] | all | CLI flag | Optional | Subset of {session-start, pre-tool-use, post-tool-use} |
| `--dry-run` | boolean | false | CLI flag | Optional | N/A |
| `--verbose` | boolean | false | CLI flag | Optional | N/A |
| `--json` | boolean | false | CLI flag | Optional | Mutually exclusive with TUI |
| `--log-file <path>` | string | - | CLI flag | Optional | Valid file path, writable |
| `--no-color` | boolean | false | CLI flag | Optional | Respects NO_COLOR env |

### 2. Store Configuration

| Field | Type | Default | Constraints | Validation |
|-------|------|---------|-------------|------------|
| `storeId` | string | auto-generated | 1-64 chars, lowercase alphanumeric + hyphens, unique | regex: `^[a-z0-9-]{1,64}$` |
| `storePath` | string | `~/.fabric/stores/<id>` | Absolute path or ~-prefixed, parent dir exists | path.resolve() + fs.existsSync(parent) |
| `storeType` | enum | local | {local, remote} | Enum validation |
| `isDefault` | boolean | true | N/A | N/A |
| `remoteUrl` | string | - | Valid Git URL, accessible | URL parse + git ls-remote |
| `branch` | string | main | Valid Git ref | git ref validation |

### 3. Client Configuration

| Field | Type | Default | Constraints | Validation |
|-------|------|---------|-------------|------------|
| `clientType` | enum | - | {claude, cursor, codex} | Enum validation |
| `configPath` | string | auto-detected | Client-specific default path | fs.existsSync() |
| `hookPath` | string | `<client>/.hooks/` | Client-specific path | N/A |
| `mcpConfigPath` | string | client-specific | Client-specific config file | fs.existsSync() |

**Client-Specific Defaults**:

| Client | Config Path | Hook Path | MCP Config |
|--------|-------------|-----------|------------|
| Claude Code | `.claude/settings.json` | `.claude/hooks/` | `mcpServers.fabric` |
| Cursor | `.cursor/settings.json` | `.cursor/hooks/` | `mcpServers.fabric` |
| Codex CLI | `.codex/config.json` | `.codex/hooks/` | `mcp.servers.fabric` |

### 4. Hook Configuration

| Field | Type | Default | Constraints | Validation |
|-------|------|---------|-------------|------------|
| `hookType` | enum | - | {session-start, pre-tool-use, post-tool-use} | Enum validation |
| `templateSource` | string | bundled | Path to template dir | fs.existsSync() |
| `enabledHooks` | HookType[] | [all] | Subset of valid hooks | Enum validation |
| `timeoutMs` | number | 30000 | 1000-60000 | Range check |
| `retryCount` | number | 3 | 0-5 | Range check |

### 5. MCP Configuration

| Field | Type | Default | Constraints | Validation |
|-------|------|---------|-------------|------------|
| `serverName` | string | fabric | Non-empty, alphanumeric | regex: `^[a-z0-9]+$` |
| `command` | string | `node <mcp-server-path>` | Valid Node.js path | fs.existsSync() |
| `args` | string[] | [] | Valid CLI arguments | N/A |
| `env` | Record<string, string> | {} | Valid env vars | Key: alphanumeric + underscore |
| `capabilities` | string[] | auto | Fabric MCP capabilities | N/A |

### 6. Output Configuration

| Field | Type | Default | Constraints | Validation |
|-------|------|---------|-------------|------------|
| `interactive` | boolean | true | N/A | N/A |
| `color` | boolean | auto-detected | N/A | Respects NO_COLOR env |
| `verbose` | boolean | false | N/A | N/A |
| `json` | boolean | false | N/A | N/A |
| `logFile` | string | - | Valid file path | path.resolve() |
| `lineWidth` | number | auto-detected | 40-200 | Terminal width detection |

## Validation Rules

### Path Validation

```typescript
interface PathValidation {
  rules: [
    'Must be absolute path or start with ~/',
    'Must not contain path traversal (..)',
    'Must not exceed 260 chars (Windows limit)',
    'Parent directory must exist',
    'Target must not already exist (for new stores)',
    'Must be writable (permission check)',
  ];
  
  validate(path: string): ValidationResult {
    // Resolve ~ to home directory
    const resolved = path.startsWith('~') 
      ? path.replace('~', os.homedir())
      : path;
    
    // Check absolute
    if (!path.isAbsolute(resolved)) {
      return { valid: false, error: 'Path must be absolute' };
    }
    
    // Check traversal
    if (resolved.includes('..')) {
      return { valid: false, error: 'Path traversal not allowed' };
    }
    
    // Check length
    if (resolved.length > 260) {
      return { valid: false, error: 'Path exceeds maximum length' };
    }
    
    // Check parent exists
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) {
      return { valid: false, error: `Parent directory does not exist: ${parent}` };
    }
    
    // Check writable
    try {
      fs.accessSync(parent, fs.constants.W_OK);
    } catch {
      return { valid: false, error: 'No write permission to parent directory' };
    }
    
    return { valid: true };
  }
}
```

### URL Validation (Git Remote)

```typescript
interface URLValidation {
  rules: [
    'Must be valid Git URL (HTTPS or SSH)',
    'Must be accessible (public or with credentials)',
    'Must contain .fabric/ directory structure',
  ];
  
  async validate(url: string): Promise<ValidationResult> {
    // Parse URL
    try {
      new URL(url);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
    
    // Check accessibility (git ls-remote)
    try {
      await execAsync(`git ls-remote ${url}`);
    } catch (error) {
      return { valid: false, error: `Cannot access remote: ${error.message}` };
    }
    
    // Check Fabric structure (requires clone)
    // Optional, done during connection
    
    return { valid: true };
  }
}
```

### ID Validation

```typescript
interface IDValidation {
  rules: [
    'Must be 1-64 characters',
    'Must be lowercase alphanumeric with hyphens',
    'Must be unique within stores',
    'Must not start or end with hyphen',
  ];
  
  validate(id: string, existingIds: string[]): ValidationResult {
    // Check length
    if (id.length < 1 || id.length > 64) {
      return { valid: false, error: 'ID must be 1-64 characters' };
    }
    
    // Check format
    if (!/^[a-z0-9-]+$/.test(id)) {
      return { valid: false, error: 'ID must be lowercase alphanumeric with hyphens' };
    }
    
    // Check start/end
    if (id.startsWith('-') || id.endsWith('-')) {
      return { valid: false, error: 'ID must not start or end with hyphen' };
    }
    
    // Check unique
    if (existingIds.includes(id)) {
      return { valid: false, error: 'ID already exists' };
    }
    
    return { valid: true };
  }
}
```

### Client Selection Validation

```typescript
interface ClientValidation {
  rules: [
    'Must be subset of supported clients',
    'At least one client must be selected',
    'Client config directory must exist',
  ];
  
  validate(clients: ClientType[]): ValidationResult {
    // Check supported
    const supported: ClientType[] = ['claude', 'cursor', 'codex'];
    const invalid = clients.filter(c => !supported.includes(c));
    if (invalid.length > 0) {
      return { valid: false, error: `Unsupported clients: ${invalid.join(', ')}` };
    }
    
    // Check at least one
    if (clients.length === 0) {
      return { valid: false, error: 'At least one client must be selected' };
    }
    
    // Check directories (warning only)
    const warnings: string[] = [];
    for (const client of clients) {
      const dir = getClientDirectory(client);
      if (!fs.existsSync(dir)) {
        warnings.push(`${client} directory not found: ${dir}`);
      }
    }
    
    return { valid: true, warnings };
  }
}
```

## Config Schema (Zod)

```typescript
import { z } from 'zod';

// Store configuration schema
const StoreConfigSchema = z.object({
  storeId: z.string()
    .min(1, 'ID must be at least 1 character')
    .max(64, 'ID must be at most 64 characters')
    .regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with hyphens')
    .refine(s => !s.startsWith('-') && !s.endsWith('-'), 'ID must not start or end with hyphen'),
  
  storePath: z.string()
    .refine(p => p.startsWith('/') || p.startsWith('~'), 'Path must be absolute or start with ~'),
  
  storeType: z.enum(['local', 'remote']),
  
  isDefault: z.boolean().default(true),
  
  remoteUrl: z.string().url().optional(),
  
  branch: z.string().default('main'),
});

// Client type schema
const ClientTypeSchema = z.enum(['claude', 'cursor', 'codex']);

// Hook type schema
const HookTypeSchema = z.enum(['session-start', 'pre-tool-use', 'post-tool-use']);

// Install configuration schema
const InstallConfigSchema = z.object({
  projectPath: z.string(),
  store: StoreConfigSchema,
  clients: z.array(ClientTypeSchema).min(1),
  hooks: z.object({
    enabledHooks: z.array(HookTypeSchema).default([
      'session-start',
      'pre-tool-use',
      'post-tool-use',
    ]),
    templateSource: z.string().optional(),
    timeoutMs: z.number().min(1000).max(60000).default(30000),
    retryCount: z.number().min(0).max(5).default(3),
  }),
  mcp: z.object({
    serverName: z.string().regex(/^[a-z0-9]+$/).default('fabric'),
    env: z.record(z.string()).optional(),
  }),
  output: z.object({
    interactive: z.boolean().default(true),
    color: z.boolean().default(true),
    verbose: z.boolean().default(false),
    json: z.boolean().default(false),
    logFile: z.string().optional(),
  }),
});

// Uninstall configuration schema
const UninstallConfigSchema = z.object({
  projectPath: z.string(),
  clients: z.array(ClientTypeSchema).optional(),
  deleteStore: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  output: z.object({
    interactive: z.boolean().default(true),
    color: z.boolean().default(true),
    verbose: z.boolean().default(false),
  }),
});
```

## Default Values Resolution

### Resolution Priority

1. **CLI flag**: User explicitly provides value
2. **Stored preference**: Value from `~/.fabric/config.json`
3. **Auto-detected**: Value from environment detection
4. **Hardcoded default**: Built-in default value

### Preference File Schema

```json
// ~/.fabric/config.json
{
  "preferences": {
    "defaultStore": "my-team-kb",
    "preferredClients": ["claude", "cursor"],
    "defaultHooks": ["session-start", "pre-tool-use"],
    "output": {
      "color": true,
      "verbose": false
    }
  },
  "lastInstall": {
    "storeId": "my-team-kb",
    "clients": ["claude"],
    "timestamp": "2026-06-06T10:00:00Z"
  }
}
```

### Auto-Detection Logic

```typescript
async function autoDetectClients(): Promise<ClientType[]> {
  const clients: ClientType[] = [];
  
  // Claude Code
  if (fs.existsSync('.claude/') || await hasBinary('claude')) {
    clients.push('claude');
  }
  
  // Cursor
  if (fs.existsSync('.cursor/') || process.env.CURSOR_SESSION) {
    clients.push('cursor');
  }
  
  // Codex CLI
  if (fs.existsSync('.codex/') || await hasBinary('codex')) {
    clients.push('codex');
  }
  
  return clients;
}
```

## References

- **ADR-001**: Install pipeline stages
- **ADR-004**: Store wizard validation
- **ADR-005**: Uninstall config symmetry
- **state-machine.md**: State transitions
- **Zod Documentation**: https://zod.dev