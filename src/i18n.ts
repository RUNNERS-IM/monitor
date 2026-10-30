// Screen text for the panel. The tray menu in Rust reads the same files in `locales/`.
import ko from "../locales/ko.json";

type Key = keyof typeof ko;
type Table = Record<string, string>;

// Every `locales/<code>.json` is bundled; the file name is the locale code (e.g. `zh-Hans`).
const files = import.meta.glob<Table>("../locales/*.json", { eager: true, import: "default" });
const tables: Record<string, Table> = Object.fromEntries(
  Object.entries(files).map(([path, table]) => [path.replace(/^.*\/(.+)\.json$/, "$1"), table]),
);

/** Picks the best bundled locale for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else `en`. */
function pickLocale(tag: string): string {
  const exact = Object.keys(tables).find((code) => code.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const language = tag.split(/[-_]/)[0].toLowerCase();
  // Why: Taiwan, Hong Kong and Macau write traditional characters; every other Chinese tag reads simplified.
  if (language === "zh") return /-(hant|tw|hk|mo)\b/i.test(tag.replace(/_/g, "-")) ? "zh-Hant" : "zh-Hans";
  return language in tables ? language : "en";
}

export const locale = pickLocale(navigator.language || "en");
const table: Table = tables[locale];

document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";

/** Looks up `key` and fills `{{name}}` slots; a missing key shows the key itself so it is easy to spot. */
export function t(key: Key, args: Record<string, string | number> = {}): string {
  let text = table[key] ?? key;
  for (const [name, value] of Object.entries(args)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}
