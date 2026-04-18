export const DEFAULT_IGNORES = [
  "**/*.meta",
  "library/**",
  "temp/**",
  "build/**",
  "settings/**",
  "profiles/**",
  "node_modules/**",
  "dist/**",
  ".git/**",
  ".fabric/**",
];

export function resolveIgnores(fabricConfig?: { scanIgnores?: string[] }): string[] {
  return [...DEFAULT_IGNORES, ...(fabricConfig?.scanIgnores ?? [])];
}
