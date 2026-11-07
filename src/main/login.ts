// 「로그인할 때 열기」. 동작은 kit 부품이 하고, 여기에는 Monitor 만의 두 가지를 둔다: 개발 실행 막기와 Tauri 판에서 넘어오기.
import { app } from 'electron'
import { existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLoginItem } from './runners/login-item'

/** Tauri 판 Monitor 가 데이터를 두던 폴더. 그 표시도 인정해 거기서 고른 값을 지킨다. */
const TAURI_DATA = 'im.runners.monitor'
const TAURI_MARKER = 'open-at-login-default'
/** Tauri 판이 남긴 로그인 항목(tauri-plugin-autostart). */
const TAURI_LAUNCH_AGENT = join(homedir(), 'Library', 'LaunchAgents', 'Monitor.plist')

const item = createLoginItem({
  app,
  name: 'Monitor',
  migrate: () => existsSync(join(app.getPath('appData'), TAURI_DATA, TAURI_MARKER))
})

export const isOn = item.isOn

export function setOn(on: boolean): void {
  // Why: 개발 실행이 쓰면 개발용 Electron.app 이 맥의 로그인 항목에 남아, 로그인 때 그것이 열린다.
  if (!app.isPackaged) {
    return
  }
  item.setOn(on)
}

/** 메뉴 줄: 뒤집고 지금 값을 돌려준다. */
export function toggle(): boolean {
  setOn(!isOn())
  return isOn()
}

/** 출시판에서만 처음 한 번 켠다. */
export function applyDefault(): void {
  if (!app.isPackaged) {
    return
  }
  // Why: Tauri 판의 LaunchAgent 는 옛 실행 파일을 가리킨다. 앱 자신의 항목으로 바꿔 이름으로 보이게 하고, 켜 둔 선택은 지킨다.
  if (process.platform === 'darwin' && existsSync(TAURI_LAUNCH_AGENT)) {
    try {
      unlinkSync(TAURI_LAUNCH_AGENT)
      item.setOn(true)
    } catch {
      // 다음 실행 때 다시 한다.
      return
    }
  }
  item.applyDefault()
}
