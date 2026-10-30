// Screen text for the panel. The tray menu in Rust reads the same files in `locales/`.
import en from "../locales/en.json";
import ko from "../locales/ko.json";

type Key = keyof typeof ko;

const table: Record<string, string> = navigator.language.startsWith("ko") ? ko : en;

/** Looks up `key` and fills `{{name}}` slots; a missing key shows the key itself so it is easy to spot. */
export function t(key: Key, args: Record<string, string | number> = {}): string {
  let text = table[key] ?? key;
  for (const [name, value] of Object.entries(args)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}
