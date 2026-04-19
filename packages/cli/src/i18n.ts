import { createTranslator, detectNodeLocale } from "@fenglimg/fabric-shared";

export const locale = detectNodeLocale();
export const t = createTranslator(locale);
