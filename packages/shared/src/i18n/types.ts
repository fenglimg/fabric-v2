export type Locale = "en" | "zh-CN";

export interface Messages {
  [key: string]: string;
}

export type TranslationKey = string;

export type Translator = (key: TranslationKey, vars?: Record<string, string>) => string;
