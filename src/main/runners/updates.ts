// GitHub 출시에서 앱을 새 판으로 바꾼다(electron-updater). 하루 한 번 보고, 켜고 약 1분 뒤 첫 확인을 한다.
// 새 판을 먼저 받아 두고 그 뒤에 묻는다. 그래서 「지금 설치」를 누르면 바로 다시 시작한다(RUNNERS 앱 공통 규칙).
// Electron 과 앱 창은 넘겨받는다. 그래서 앱마다 그대로 복사해 쓰고 Electron 없이 시험한다.
import { releaseNoteLines } from './release-notes'

const FIRST_CHECK_MS = 60_000
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
// 하루가 지났는지 보는 일은 가벼우니 자주 봐서, 오래 잠든 뒤에도 곧 따라잡는다.
const TICK_MS = 60 * 60 * 1000

export type UpdateAnswer = 'install' | 'later'
export type UpdateOffer = {
  version: string
  notes: string[] | null
  downloading: boolean
  percent: number
}
/** 떠 있는 업데이트 창. 누른 답(닫으면 later)과 상태를 바꾸는 길. */
export type UpdatePrompt = {
  answer: Promise<UpdateAnswer>
  set: (change: Partial<UpdateOffer>) => void
  close: () => void
}

type Progress = { percent: number }

export type UpdaterLike = {
  autoDownload: boolean
  fullChangelog: boolean
  autoInstallOnAppQuit: boolean
  on: (event: string, listener: (value: never) => void) => unknown
  off: (event: string, listener: (value: never) => void) => unknown
  checkForUpdates: () => Promise<{
    isUpdateAvailable?: boolean
    updateInfo: { version: string; releaseNotes?: unknown }
  } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

export type UpdateSettings = {
  autoUpdate?: boolean
  updateLaterOn?: string | null
  updateCheckedAt?: number
}

export type UpdatesOptions = {
  isPackaged: boolean
  autoUpdater: UpdaterLike
  onResume: (listener: () => void) => void
  readSettings: () => UpdateSettings
  writeSettings: (change: UpdateSettings) => void
  /** 창 문구 언어. 새 소식은 한국어 · 영어 두 가지만 있다. */
  locale: () => string
  t: (key: string, args?: Record<string, string | number>) => string
  /** focus 가 false 면 앞으로 나오지 않는다. 다른 앱에 치던 Return 이 「지금 설치」에 떨어지지 않게 하려는 것이다. */
  askUpdate: (offer: UpdateOffer, focus: boolean) => UpdatePrompt
  /** 앱을 끝내도 되는 상태로 만든다. 창 닫기를 막아 둔 앱은 여기서 풀어야 설치가 된다. */
  beforeInstall?: () => void
  /** 최신판이라는 말이나 실패를 알린다. */
  tell: (message: string) => Promise<unknown>
}

export type Updates = ReturnType<typeof createUpdates>

/** 내 컴퓨터 날짜 `2026-10-30` */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function createUpdates(options: UpdatesOptions) {
  const { autoUpdater, readSettings, writeSettings, askUpdate, t } = options
  let busy = false

  /** 하루 확인: 조용히 받은 뒤에 앞으로 나오지 않는 창으로 묻는다. */
  const askAfterDownload = async (version: string, notes: string[] | null) => {
    await autoUpdater.downloadUpdate()
    return askUpdate({ version, notes, downloading: false, percent: 100 }, false).answer
  }

  /** 메뉴의 「업데이트 확인」: 기다리는 사람이 있으니 창을 바로 띄워 받는 모습을 보여 준다.
   *  받는 동안 닫아도 받기는 이어지고, 다 받으면 설치할 수 있는 창이 다시 뜬다. */
  const askWhileDownloading = async (version: string, notes: string[] | null) => {
    const prompt = askUpdate({ version, notes, downloading: true, percent: 0 }, true)
    const progress = (info: Progress) => prompt.set({ percent: info.percent })
    autoUpdater.on('download-progress', progress)
    let done = false
    let failed: unknown = null
    // electron-updater 는 받는 중이면 그 받기를 돌려주므로 두 번 받지 않는다.
    const download = autoUpdater
      .downloadUpdate()
      .then(() => {
        done = true
        prompt.set({ downloading: false, percent: 100 })
      })
      .catch((error: unknown) => {
        failed = error
        prompt.close()
      })
      .finally(() => autoUpdater.off('download-progress', progress))
    const first = await prompt.answer
    if (failed) {
      throw failed
    }
    if (first === 'install' || done) {
      return first
    }
    await download
    if (failed) {
      throw failed
    }
    return askUpdate({ version, notes, downloading: false, percent: 100 }, false).answer
  }

  const check = async (asked: boolean) => {
    if (busy || (!asked && readSettings().autoUpdate === false)) {
      return
    }
    busy = true
    try {
      if (!options.isPackaged) {
        throw new Error('a development build does not update')
      }
      const result = await autoUpdater.checkForUpdates()
      writeSettings({ updateCheckedAt: Date.now() })
      if (!result?.isUpdateAvailable) {
        if (asked) {
          await options.tell(t('update.latest'))
        }
        return
      }
      // 「나중에」는 오늘은 다시 묻지 않는다는 뜻이다. 메뉴에서 직접 확인하면 같은 날에도 묻는다.
      if (!asked && readSettings().updateLaterOn === today()) {
        return
      }
      const version = result.updateInfo.version
      const language = options.locale() === 'ko' ? 'ko' : 'en'
      const notes = releaseNoteLines(result.updateInfo.releaseNotes, language)
      const answer = asked
        ? await askWhileDownloading(version, notes)
        : await askAfterDownload(version, notes)
      if (answer !== 'install') {
        writeSettings({ updateLaterOn: today() })
        return
      }
      options.beforeInstall?.()
      autoUpdater.quitAndInstall(true, true)
    } catch (error) {
      if (asked) {
        const message = error instanceof Error ? error.message : String(error)
        await options.tell(t('update.failed', { error: message }))
      }
    } finally {
      busy = false
    }
  }

  const checkIfDue = async () => {
    if (Date.now() - (readSettings().updateCheckedAt ?? 0) >= CHECK_EVERY_MS) {
      await check(false)
    }
  }

  return {
    /** 출시판에서만 돈다. 개발 실행은 서명된 판이 아니라 비교하거나 설치할 것이 없다. */
    start() {
      if (!options.isPackaged) {
        return
      }
      autoUpdater.autoDownload = false
      // 「새 소식」에는 권하는 판의 내용만 보인다.
      autoUpdater.fullChangelog = false
      // 사람이 예라고 한 뒤에만 설치한다. 끝낼 때 몰래 설치하지 않는다.
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.on('error', (error: Error) => console.error('update:', error))
      setTimeout(() => {
        void checkIfDue()
        setInterval(() => void checkIfDue(), TICK_MS)
      }, FIRST_CHECK_MS)
      options.onResume(() => setTimeout(() => void checkIfDue(), FIRST_CHECK_MS))
    },
    /** 메뉴의 「업데이트 확인」. 최신판이면 그렇다고도 알린다. */
    checkNow: () => check(true)
  }
}
