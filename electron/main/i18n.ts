// Screen text for the tray, the native menu, dialogs and notifications. The page reads the same files in
// `locales/`, so every language lives in one place; vite bundles them into the main process.
import { app } from "electron";

type Table = Record<string, string>;

const files = import.meta.glob<Table>("../../locales/*.json", { eager: true, import: "default" });
const tables: Record<string, Table> = Object.fromEntries(
  Object.entries(files).map(([path, table]) => [path.replace(/^.*\/(.+)\.json$/, "$1"), table]),
);

/** Picks the best bundled locale for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else `en`. */
export function pickLocale(tag: string): string {
  const exact = Object.keys(tables).find((code) => code.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const language = tag.split(/[-_]/)[0].toLowerCase();
  // Only simplified Chinese ships, so every Chinese variant (zh-CN, zh-TW, zh-Hant…) reads it.
  if (language === "zh") return "zh-Hans";
  return language in tables ? language : "en";
}

let table: Table | null = null;

/** Looks up `key` and fills `{{name}}` slots; a missing key shows the key itself so it is easy to spot. */
export function t(key: string, args: Record<string, string | number> = {}): string {
  // Why: the system language list is only known once the app is ready, so the table is picked on first use.
  table ??= tables[pickLocale(app.getPreferredSystemLanguages()[0] ?? app.getLocale())] ?? tables.en;
  let text = table[key] ?? key;
  for (const [name, value] of Object.entries(args)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}
