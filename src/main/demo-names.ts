// 데모 실행(MONITOR_DEMO · 시험 촬영)에 나오는 다른 회사 앱 이름과 데모 컴퓨터 이름을 그 언어의 일반 이름으로 바꾼다.
// Why: 스토어 · 홈페이지 사진에는 다른 회사 앱 이름(Google Chrome · Slack 등)을 넣지 않기로 했다
// (runners-wiki 2026-11-11 「휴대폰 앱 심사는 … 일반 이름 사진」 2A). 데모 숫자는 native 의 demo.rs 와 peers.ts 가 만들고, 이름만 여기서 바꾼다.
import { tFor } from './i18n'

/** 데모에 나오는 앱 이름 → locales 의 demo.* 열쇠. 우리 앱(Prompt)과 명령 이름(nuxt dev · node)은 그대로 둔다. */
const APPS: Record<string, string> = {
  'Google Chrome': 'demo.browser',
  Safari: 'demo.browser',
  Slack: 'demo.messenger',
  claude: 'demo.ai',
  Figma: 'demo.design',
  Xcode: 'demo.code',
  Simulator: 'demo.simulator',
  Docker: 'demo.containers',
  Terminal: 'demo.terminal',
  Zoom: 'demo.meeting',
  Keynote: 'demo.slides'
}

export type DemoComputer = 'designMac' | 'buildMac' | 'meetingMac' | 'serverMac' | 'laptop'

export function demoAppName(name: string, lang: string): string {
  const key = APPS[name]
  return key ? tFor(lang, key) : name
}

export function demoComputerName(computer: DemoComputer, lang: string): string {
  return tFor(lang, `demo.${computer}`)
}
