// GitHub 출시(RUNNERS-IM/monitor)에서 새 판을 받는다. 동작은 kit 부품이 하고, 여기서는 Electron 을 잇기만 한다.
import { app, dialog, powerMonitor } from 'electron'
import { autoUpdater } from 'electron-updater'
import { currentLocale, t } from './i18n'
import { createUpdates, type Updates, type UpdaterLike } from './runners/updates'
import { readSettings, writeSettings } from './settings'
import { askUpdate } from './windows'

async function tell(message: string): Promise<void> {
  app.focus({ steal: true })
  await dialog.showMessageBox({ type: 'info', message, buttons: ['OK'] })
}

let made: Updates | null = null

// Why: autoUpdater 는 처음 읽을 때 만들어진다. 앱이 준비되기 전, 파일을 불러오는 때에 만들지 않는다.
function updates(): Updates {
  made ??= createUpdates({
    isPackaged: app.isPackaged,
    autoUpdater: autoUpdater as unknown as UpdaterLike,
    onResume: (listener) => powerMonitor.on('resume', listener),
    readSettings,
    writeSettings,
    locale: currentLocale,
    t,
    askUpdate,
    tell
  })
  return made
}

export function startUpdates(): void {
  updates().start()
}

/** 메뉴의 「업데이트 확인」. */
export function checkNow(): void {
  void updates().checkNow()
}
