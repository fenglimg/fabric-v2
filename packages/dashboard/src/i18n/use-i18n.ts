import { useContext } from "preact/hooks";

import { I18nContext } from "./provider";

export function useI18n() {
  const value = useContext(I18nContext);

  if (value === null) {
    throw new Error("useI18n must be used within an I18nProvider.");
  }

  return value;
}
