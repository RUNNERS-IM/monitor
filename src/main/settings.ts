// Monitor 의 설정(userData 안의 settings.json). 읽고 쓰는 일은 kit 부품이 한다.
import { app } from 'electron'
import { join } from 'node:path'
import { createSettingsFile } from './runners/settings-file'

export type Settings = {
  /** 켜면(기본) 새 판을 받아 두었다가 쉬는 중이거나 앱을 끌 때 깐다. 끄면 하루 한 번 확인하고 깔기 전에 묻는다. */
  autoUpdate: boolean
  /** The day (`2026-10-30`) "Later" was chosen in the update dialog, so the daily check does not ask again that day. */
  updateLaterOn: string | null
  /** The day (`Sat Oct 31 2026`) each slow-computer notice was last shown. Why: once a day, even across restarts. */
  noticedOn: Partial<Record<'memory' | 'cpu', string>>
  /** When (Unix ms) the daily update check last reached GitHub. Why: a timer stops while the Mac sleeps, so a laptop kept
   *  closed went days without a check; this lets launch and wake check when a day has passed. */
  updateCheckedAt?: number
  /** Runners paused from the panel or a phone, by name, with the Unix time (seconds) they come back.
   *  Why: a restart of Monitor inside the hour would otherwise show the runner as gone instead of paused. */
  pausedRunners?: Record<string, number>
  /** Whether the menu-bar icon shows (Settings › General). Missing means shown. */
  showTrayIcon?: boolean
  /** 저절로 깔려고 받아 둔 판(kit updates.ts). 다음에 열 때 한 번 「업데이트했습니다」를 보이고 지운다. */
  updateReady?: { version: string; notes: string[] | null } | null
  /** This computer's id on the relay (src/main/relay.ts), made once so phones keep seeing the same computer. */
  deviceId?: string
}

const DEFAULTS: Settings = { autoUpdate: true, updateLaterOn: null, noticedOn: {} }

// Why: 개발 실행은 index.ts 가 userData 를 바꾸므로 부를 때마다 위치를 읽는다.
const file = () =>
  createSettingsFile<Settings>(join(app.getPath('userData'), 'settings.json'), DEFAULTS)

export function readSettings(): Settings {
  return file().read()
}

export function writeSettings(change: Partial<Settings>): Settings {
  return file().write(change)
}
