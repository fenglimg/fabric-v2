import type { Locale } from "./types.js";

export function normalizeLocale(raw: string | null | undefined): Locale {
  if (typeof raw !== "string") {
    return "en";
  }

  const normalized = raw.trim().toLowerCase().replace(/\..*$/, "").replace(/_/g, "-");

  if (normalized.length === 0) {
    return "en";
  }

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  return "en";
}
