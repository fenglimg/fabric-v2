import { redactSecrets } from "@fenglimg/fabric-shared";

const PERSONAL_ID_PATTERN = /\bKP-[A-Z]+-\d{4}\b/u;
const PERSONAL_PATH_PATTERN = /(?:^|[/\\])(?:personal|\.fabric[/\\]stores[/\\][^/\\]*personal[^/\\]*)(?:[/\\]|$)/iu;
const PERSONAL_SCOPE_KEYS = new Set([
  // W4/Track1 (D1): `knowledge_layer` removed — that field no longer exists; a
  // candidate's layer is derived from its stable_id prefix (KT-DEC-0004).
  "layer",
  "origin",
  "scope",
  "semantic_scope",
  "visibility_store",
]);

export function sanitizeHttpKnowledgePayload<T>(payload: T): T {
  return sanitizeValue(payload) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeValue(entry))
      .filter((entry) => entry !== undefined);
  }

  if (!isRecord(value)) {
    return value;
  }

  if (isPersonalScopedRecord(value)) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isPersonalScopeString(key)) {
      continue;
    }

    const sanitized = sanitizeValue(nested);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  return output;
}

function isPersonalScopedRecord(value: Record<string, unknown>): boolean {
  for (const [key, nested] of Object.entries(value)) {
    if (PERSONAL_SCOPE_KEYS.has(key) && nested === "personal") {
      return true;
    }

    if (typeof nested === "string" && isPersonalScopeString(nested)) {
      return true;
    }

    if (isPersonalPathArrayField(key, nested)) {
      return true;
    }
  }

  return false;
}

function isPersonalPathArrayField(key: string, value: unknown): boolean {
  return (
    (key === "affected_paths" || key === "paths" || key.endsWith("_paths")) &&
    Array.isArray(value) &&
    value.some((entry) => typeof entry === "string" && isPersonalScopeString(entry))
  );
}

function isPersonalScopeString(value: string): boolean {
  return PERSONAL_ID_PATTERN.test(value) || PERSONAL_PATH_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
