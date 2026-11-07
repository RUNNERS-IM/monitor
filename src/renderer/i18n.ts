// Screen text for the panel. The tray menu in Rust reads the same files in `locales/`.
import type ko from '../locales/ko.json'

type Key = keyof typeof ko
type Table = Record<string, string>

// Every `locales/<code>.json` is bundled; the file name is the locale code (e.g. `zh-Hans`).
const files = import.meta.glob<Table>('../locales/*.json', { eager: true, import: 'default' })
const tables: Record<string, Table> = Object.fromEntries(
  Object.entries(files).map(([path, table]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), table])
)

/** The bundled locale for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else none. */
function matchLocale(tag: string): string | null {
  const exact = Object.keys(tables).find((code) => code.toLowerCase() === tag.toLowerCase())
  if (exact) {
    return exact
  }
  const language = tag.split(/[-_]/)[0].toLowerCase()
  // Why: Taiwan, Hong Kong and Macau write traditional characters; every other Chinese tag reads simplified.
  if (language === 'zh') {
    return /-(hant|tw|hk|mo)\b/i.test(tag.replace(/_/g, '-')) ? 'zh-Hant' : 'zh-Hans'
  }
  return language in tables ? language : null
}

/** The first language in the person's list that has a table, else `en`. Why the whole list: someone with a language
 *  we lack on top and Korean second should read Korean, not English. */
function pickLocale(tags: readonly string[]): string {
  for (const tag of tags) {
    const code = matchLocale(tag)
    if (code) {
      return code
    }
  }
  return 'en'
}

// Why: a debug run can pick the language per window (`?lang=ja`), so one run can capture every language for the homepage.
const debugLang = import.meta.env.DEV ? new URLSearchParams(location.search).get('lang') : null
export const locale = pickLocale(debugLang ? [debugLang] : navigator.languages)
const table: Table = tables[locale]

document.documentElement.lang = locale
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'

/** Looks up `key` and fills `{{name}}` slots; a key this language lacks reads in English. */
export function t(key: Key, args: Record<string, string | number> = {}): string {
  let text = table[key] ?? tables.en[key] ?? key
  for (const [name, value] of Object.entries(args)) {
    text = text.replaceAll(`{{${name}}}`, String(value))
  }
  return text
}
