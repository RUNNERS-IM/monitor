// 「로그인할 때 열기」. RUNNERS 앱은 기본으로 켜 둔다. 출시판을 처음 켤 때 한 번만 켜고, 그 뒤에는 메뉴로만 바꾼다.
// 그래서 끄면 꺼진 채로 남는다. macOS 13 이상은 앱 자체를 등록하고, Windows 는 Run 키, Linux 는 autostart 파일을 쓴다.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_APPLIED = 'open-at-login-default'

export type LoginItemApp = {
  isPackaged: boolean
  getPath: (name: 'userData') => string
  getLoginItemSettings: (options?: { args?: string[] }) => { openAtLogin: boolean }
  setLoginItemSettings: (settings: { openAtLogin: boolean; args?: string[] }) => void
}

export type LoginItemOptions = {
  app: LoginItemApp
  /** autostart 파일과 표시 이름에 쓴다. 예: Monitor */
  name: string
  /** 로그인으로 켜졌음을 알리는 인자(창을 띄우지 않으려는 앱). 예: --hidden */
  hiddenArg?: string
  /** 처음 켤 때 기본값을 켜지 않을 때 참(Mac App Store 판 등). */
  skipDefault?: () => boolean
  /** 옛 판이 남긴 등록을 옮기고 참을 돌려주면 그 선택을 지키고 기본값을 적용한 것으로 친다. */
  migrate?: () => boolean
  platform?: NodeJS.Platform
  homeDir?: string
  execPath?: string
}

export type LoginItem = ReturnType<typeof createLoginItem>

export function createLoginItem(options: LoginItemOptions) {
  const { app, name, hiddenArg } = options
  const platform = options.platform ?? process.platform
  const home = options.homeDir ?? homedir()
  const autostart = join(home, '.config', 'autostart', `${name.toLowerCase()}.desktop`)
  const args = hiddenArg ? [hiddenArg] : undefined

  const isOn = () => {
    if (platform === 'linux') {
      return existsSync(autostart)
    }
    // Windows 는 등록할 때와 같은 args 로 물어야 켜져 있다고 답한다.
    return app.getLoginItemSettings(args ? { args } : undefined).openAtLogin
  }

  const setOn = (on: boolean) => {
    // 개발 실행은 등록하지 않는다. 등록하면 로그인할 때 개발용 Electron 이 켜진다.
    if (!app.isPackaged) {
      return
    }
    if (platform !== 'linux') {
      app.setLoginItemSettings(args ? { openAtLogin: on, args } : { openAtLogin: on })
      return
    }
    if (!on) {
      rmSync(autostart, { force: true })
      return
    }
    // AppImage 는 임시 위치에서 돌아가므로 AppImage 파일 자체를 적는다.
    const exec = options.execPath ?? process.env.APPIMAGE ?? process.execPath
    const line = hiddenArg ? `"${exec}" ${hiddenArg}` : `"${exec}"`
    mkdirSync(join(home, '.config', 'autostart'), { recursive: true })
    writeFileSync(
      autostart,
      `[Desktop Entry]\nType=Application\nName=${name}\nExec=${line}\nX-GNOME-Autostart-enabled=true\n`
    )
  }

  return {
    isOn,
    setOn,
    /** 메뉴 줄: 뒤집고 지금 값을 돌려준다. */
    toggle() {
      setOn(!isOn())
      return isOn()
    },
    /** 출시판에서만 처음 한 번 켠다. 개발 실행은 건드리지 않아 개발용 Electron 이 등록되지 않게 한다. */
    applyDefault() {
      if (!app.isPackaged) {
        return
      }
      const folder = app.getPath('userData')
      const marker = join(folder, DEFAULT_APPLIED)
      const markApplied = () => {
        mkdirSync(folder, { recursive: true })
        writeFileSync(marker, '')
      }
      if (existsSync(marker)) {
        return
      }
      if (options.migrate?.()) {
        markApplied()
        return
      }
      if (!options.skipDefault?.()) {
        setOn(true)
      }
      markApplied()
    }
  }
}
