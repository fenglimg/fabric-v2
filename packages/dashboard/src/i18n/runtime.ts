import { createTranslator, normalizeLocale, type Locale, type Translator } from "@fenglimg/fabric-shared/i18n";

declare const __DASHBOARD_FAB_LANG__: string | null;

export type DashboardI18nRuntime = {
  locale: Locale;
  t: Translator;
};

export function detectBrowserLocale(): Locale {
  if (typeof __DASHBOARD_FAB_LANG__ === "string" && __DASHBOARD_FAB_LANG__.trim().length > 0) {
    return normalizeLocale(__DASHBOARD_FAB_LANG__);
  }

  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    return normalizeLocale(navigator.language);
  }

  return "en";
}

export function createDashboardI18nRuntime(locale: Locale = detectBrowserLocale()): DashboardI18nRuntime {
  return {
    locale,
    t: createTranslator(locale),
  };
}
