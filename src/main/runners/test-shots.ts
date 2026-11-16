// 시험 촬영 모드. 앱을 RUNNERS_TEST_SHOTS=<폴더> 로 켜면 앱이 스스로 화면을 하나씩 열어 사진을 찍고 꺼진다.
// 사람이 누르지 않아도 다섯 앱의 화면 확인 사진이 같은 이름 · 같은 차례로 나오게 하려고 둔다
// (규약: ~/git/runners/_docs/[PROGRAM] 시험 촬영 규약.md, 2026-11-16 사용자: 「모든 세션 그 시험 촬영 모드 다 통일되게 해줘」).
// Draw 의 src/main/testShots.ts 에서 앱마다 같은 부분(변수 읽기 · 파일 이름 · 테마 바꾸기 · 창 숨기기 · 목록 파일 · 끝나면 끄기)만 옮겼다.
// 어느 화면을 어떻게 여는지는 앱마다 달라서 앱이 scenes 로 넘긴다.
//
// 변수
//   RUNNERS_TEST_SHOTS=<폴더>              켜기. 사진과 shots.json 을 이 폴더에 둔다
//   RUNNERS_TEST_LANG=ko,en                 찍을 언어(기본 ko,en)
//   RUNNERS_TEST_SCOPE=all                  찍을 묶음(기본 all). settings · menu · popups · account · main 을 쉼표로
//   RUNNERS_TEST_ACCOUNT=signin|signed-in   로그인 화면이 필요한 앱이 고를 계정 상태
// 파일 이름: <언어>-<light|dark>-<두 자리 번호>-<범위>-<화면>.png. 번호는 언어 · 테마마다 1 부터 다시 세어, 같은 화면은 밝은 · 어두운 사진이 같은 번호가 된다.
// 고르지 않은 범위의 화면도 번호는 하나 차지한다. 범위를 좁혀 다시 찍어도 같은 화면이 같은 번호로 나와 지난 사진과 견줄 수 있다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TEST_SHOT_SCOPES = ['settings', 'menu', 'popups', 'account', 'main'] as const
export type TestShotScope = (typeof TEST_SHOT_SCOPES)[number]
export type TestShotTheme = 'light' | 'dark'
export type TestShotAccount = 'signin' | 'signed-in'

export type TestShotsConfig = {
  dir: string
  langs: string[]
  scopes: TestShotScope[]
  account: TestShotAccount | null
  /** 읽다가 걸러 낸 값. 시험이 조용히 다른 일을 하지 않게 shots.json 에 남긴다. */
  warnings: string[]
}

/** RUNNERS_TEST_SHOTS 가 없으면 null(보통 실행). */
export function readTestShots(env: NodeJS.ProcessEnv = process.env): TestShotsConfig | null {
  const dir = env.RUNNERS_TEST_SHOTS?.trim()
  if (!dir) {
    return null
  }
  const warnings: string[] = []
  const list = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

  const langs = [...new Set(list(env.RUNNERS_TEST_LANG))]
  const asked = list(env.RUNNERS_TEST_SCOPE)
  let scopes: TestShotScope[] = [...TEST_SHOT_SCOPES]
  if (asked.length && !asked.includes('all')) {
    const known = asked.filter((scope): scope is TestShotScope =>
      (TEST_SHOT_SCOPES as readonly string[]).includes(scope)
    )
    for (const scope of asked) {
      if (!known.includes(scope as TestShotScope)) {
        warnings.push(`모르는 범위: ${scope}`)
      }
    }
    // 모두 틀린 값이면 아무것도 안 찍고 끝나는 대신 전부 찍는다.
    if (known.length) {
      scopes = TEST_SHOT_SCOPES.filter((scope) => known.includes(scope))
    }
  }

  const rawAccount = env.RUNNERS_TEST_ACCOUNT?.trim()
  let account: TestShotAccount | null = null
  if (rawAccount === 'signin' || rawAccount === 'signed-in') {
    account = rawAccount
  } else if (rawAccount) {
    warnings.push(`모르는 계정 상태: ${rawAccount}`)
  }

  return { dir, langs: langs.length ? langs : ['ko', 'en'], scopes, account, warnings }
}

/** 앱이 준비되기 전(app.whenReady 앞)에 부른다. 서명 없는 시험판이 진짜 열쇠고리에 항목을 만들거나 묻는 창을 띄우지 않게 가짜 열쇠고리를 쓴다. */
export function prepareTestShots(
  config: TestShotsConfig | null,
  commandLine: { appendSwitch: (name: string) => void }
) {
  if (config) {
    commandLine.appendSwitch('use-mock-keychain')
  }
}

/** 파일 이름에 못 쓰는 글자(/ \ : 등)와 빈칸을 - 로 바꾼다. 한글은 그대로 둔다. */
export function shotFileName(
  lang: string,
  theme: TestShotTheme,
  index: number,
  scope: TestShotScope,
  screen: string
) {
  const name = screen
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${lang}-${theme}-${String(index).padStart(2, '0')}-${scope}-${name || 'screen'}.png`
}

/** 찍을 수 있는 창. Electron BrowserWindow 가 그대로 맞는다. */
export type ShotWindow = {
  webContents: { capturePage: () => Promise<{ toPNG: () => Buffer | Uint8Array }> }
}

/** 화면을 가리지 않게 투명하게 둘 창. 앱이 창을 보일 때 투명도를 되돌려도 늘 0 이 되게 막는다. */
export type HideableWindow = { setOpacity: (opacity: number) => void }

export function keepHidden(window: HideableWindow) {
  const setOpacity = window.setOpacity.bind(window)
  window.setOpacity = () => setOpacity(0)
  setOpacity(0)
}

export type TestShotRecord = {
  file: string
  scope: TestShotScope
  screen: string
  lang: string
  theme: TestShotTheme
  version: string
}

export type TestShotPass = {
  lang: string
  theme: TestShotTheme
  account: TestShotAccount | null
  /** 이 묶음을 찍을지. 묶음 전체를 건너뛸 때 쓴다. */
  wants: (scope: TestShotScope) => boolean
  /** 찍어 저장한다. 고르지 않은 범위면 찍지 않고 null. */
  shot: (window: ShotWindow, scope: TestShotScope, screen: string) => Promise<string | null>
  /** 사진으로 안 보이는 것(숫자 · 상태)을 shots.json 의 notes 에 남긴다. */
  note: (line: string) => void
  wait: (ms: number) => Promise<void>
}

export type TestShotsOptions = {
  config: TestShotsConfig
  app: { getVersion: () => string; quit: () => void }
  /** Electron nativeTheme. 앱 테마만 바꾸고 맥 설정은 건드리지 않는다. */
  nativeTheme: { themeSource: 'system' | 'light' | 'dark' }
  /** 언어를 바꾼다(창 다시 읽기 등은 앱이 맡는다). 언어가 하나뿐이면 부르지 않아도 된다. */
  setLanguage?: (lang: string) => Promise<void> | void
  /** 언어 · 테마마다 한 번씩 부른다. 화면을 열고 pass.shot 으로 찍는다. */
  scenes: (pass: TestShotPass) => Promise<void>
  /** 테마를 바꾼 뒤 화면이 다시 칠해질 때까지 기다리는 시간. */
  settleMs?: number
  /** 시험에서만 바꾼다. */
  writeFile?: (file: string, data: string | Buffer | Uint8Array) => void
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 언어 × 밝은 · 어두운으로 scenes 를 돌리고 shots.json 을 쓴 뒤 앱을 끈다. 오류가 나도 목록을 쓰고 끈다. */
export async function runTestShots(options: TestShotsOptions) {
  const { config, app, nativeTheme, scenes } = options
  const write = options.writeFile ?? writeFileSync
  const version = app.getVersion()
  const shots: TestShotRecord[] = []
  const notes: string[] = [...config.warnings]
  let error: string | null = null
  mkdirSync(config.dir, { recursive: true })

  try {
    if (config.langs.length > 1 && !options.setLanguage) {
      throw new Error('언어가 여럿인데 setLanguage 가 없습니다')
    }
    for (const lang of config.langs) {
      await options.setLanguage?.(lang)
      for (const theme of ['light', 'dark'] as const) {
        nativeTheme.themeSource = theme
        await pause(options.settleMs ?? 300)
        let index = 0
        const wants = (scope: TestShotScope) => config.scopes.includes(scope)
        await scenes({
          lang,
          theme,
          account: config.account,
          wants,
          note: (line) => notes.push(`[${lang} ${theme}] ${line}`),
          wait: pause,
          async shot(window, scope, screen) {
            index += 1
            if (!wants(scope)) {
              return null
            }
            const file = shotFileName(lang, theme, index, scope, screen)
            const image = await window.webContents.capturePage()
            write(join(config.dir, file), image.toPNG())
            shots.push({ file, scope, screen, lang, theme, version })
            return file
          }
        })
      }
    }
  } catch (caught) {
    error = (caught as Error)?.stack ?? String(caught)
  } finally {
    nativeTheme.themeSource = 'system'
    const list = { version, langs: config.langs, scopes: config.scopes, shots, notes, error }
    write(join(config.dir, 'shots.json'), `${JSON.stringify(list, null, 2)}\n`)
    app.quit()
  }
}
