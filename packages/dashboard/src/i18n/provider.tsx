import type { Locale, Translator } from "@fenglimg/fabric-shared/i18n";
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

import { createDashboardI18nRuntime } from "./runtime";

export type I18nContextValue = {
  locale: Locale;
  t: Translator;
};

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ComponentChildren }) {
  const value = useMemo(() => createDashboardI18nRuntime(), []);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
