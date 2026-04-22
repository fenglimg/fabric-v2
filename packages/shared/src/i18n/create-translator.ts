import { enMessages } from "./locales/en.js";
import { zhCNMessages } from "./locales/zh-CN.js";
import type { Locale, Messages, TranslationKey, Translator } from "./types.js";

export const defaultMessages: Record<Locale, Messages> = {
  en: enMessages,
  "zh-CN": zhCNMessages,
};

export function createTranslator(
  locale: Locale,
  messages: Record<Locale, Messages> = defaultMessages,
): Translator {
  const activeMessages = messages[locale] ?? messages.en;
  const fallbackMessages = messages.en;

  return (key: TranslationKey, vars?: Record<string, string>) => {
    const template = activeMessages[key] ?? fallbackMessages[key] ?? key;

    if (vars === undefined) {
      return template;
    }

    return Object.entries(vars).reduce((message, [name, value]) => {
      return message.replaceAll(`{${name}}`, value);
    }, template);
  };
}
