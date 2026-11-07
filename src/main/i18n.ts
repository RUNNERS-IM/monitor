// 트레이 · 메뉴 · 알림창 · 알림의 글.
import { app } from 'electron'
import { currentLocale as locale, startI18n, t as translate } from '../shared/i18n'

let started = false

// Why: 시스템 언어 목록은 앱이 준비된 뒤에야 알 수 있어, 처음 쓸 때 언어를 정한다.
function start(): void {
  if (started) {
    return
  }
  started = true
  // Why: 개발 실행은 `MONITOR_LANG=en` 으로 한국어 맥에서도 영어 화면을 찍을 수 있다.
  const forced = app.isPackaged ? undefined : process.env.MONITOR_LANG
  startI18n(forced ? [forced] : [...app.getPreferredSystemLanguages(), app.getLocale()])
}

export function currentLocale(): string {
  start()
  return locale()
}

export function t(key: string, args?: Record<string, string | number>): string {
  start()
  return translate(key, args)
}
