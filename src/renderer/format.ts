// Words shared by the panel and the All Computers window: sizes, lengths of time and failure reasons.
import { t } from './i18n'

export function formatGb(bytes: number): string {
  // Why: in Arabic the page reads right to left and "3.2 GB" came out as "GB 3.2"; the isolate marks keep it in order.
  return `\u2066${(bytes / 1024 ** 3).toFixed(1)} GB\u2069`
}

/** "3 days 2 h", "2 h 5 min" or "5 min". */
export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60) % 60
  const h = Math.floor(secs / 3600) % 24
  const d = Math.floor(secs / 86400)
  if (d > 0) {
    return t('time.days', { d, h })
  }
  if (h > 0) {
    return t('time.hours', { h, m })
  }
  return t('time.minutes', { m })
}

/** Why: Electron puts "Error invoking remote method …" before the reason, which says nothing to a person. */
export const cleanError = (e: unknown) =>
  String(
    e instanceof Error
      ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      : e
  )
