// GitHub 출시에서 앱을 새 판으로 바꾼다(electron-updater). 하루 한 번 보고, 켜고 약 1분 뒤 첫 확인을 한다.
// 새 판을 찾으면 바로 받아 둔다. 설정의 자동 업데이트가 켜져 있으면(기본) 묻지 않고, 맥 입력이 10분 없을 때나
// 앱을 끌 때 깔고, 다음에 열 때 한 번 「새 판으로 업데이트했습니다」를 보인다(runners-wiki 2026-11-19 결정 1A 2A).
// 앱이 넘긴 isBusy 가 참이면(Claude 가 답하는 중, 다른 기기가 연결해 쓰는 중 등) 쉬는 중이어도 다음 때로 미룬다.
// 자동 업데이트를 끄면 예전처럼 다 받은 뒤 창으로 묻는다. 메뉴의 「업데이트 확인」은 늘 창으로 묻는다.
// Electron 과 앱 창은 넘겨받는다. 그래서 앱마다 그대로 복사해 쓰고 Electron 없이 시험한다.
import { releaseNoteLines } from './release-notes'

const FIRST_CHECK_MS = 60_000
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
// 하루가 지났는지 보는 일은 가벼우니 자주 봐서, 오래 잠든 뒤에도 곧 따라잡는다.
const TICK_MS = 60 * 60 * 1000
/** 맥에 키보드 · 마우스 입력이 이만큼 없으면 쉬는 중으로 보고 받아 둔 새 판을 깐다. */
export const IDLE_INSTALL_SECONDS = 10 * 60
const IDLE_TICK_MS = 60 * 1000

export type UpdateAnswer = 'install' | 'later'
export type UpdateOffer = {
  version: string
  notes: string[] | null
  downloading: boolean
  percent: number
  /** 참이면 「설치할까요」가 아니라 「이 판으로 업데이트했습니다」 알림이다. 닫는 단추만 있다. */
  installed?: boolean
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
  // 메서드 꼴로 적어야 electron-updater 의 autoUpdater(이벤트 이름마다 다른 타입)를 그대로 넘길 수 있다.
  on(event: 'error' | 'download-progress', listener: (value: never) => void): unknown
  off(event: 'error' | 'download-progress', listener: (value: never) => void): unknown
  checkForUpdates: () => Promise<{
    isUpdateAvailable?: boolean
    updateInfo: { version: string; releaseNotes?: unknown }
  } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

export type UpdateSettings = {
  /** 끄면(false) 저절로 깔지 않고 창으로 묻는다. 없으면 켜진 것으로 본다. */
  autoUpdate?: boolean
  updateLaterOn?: string | null
  updateCheckedAt?: number
  /** 저절로 깔려고 받아 둔 판. 다음에 열 때 이 판이면 한 번 알리고 지운다. */
  updateReady?: { version: string; notes: string[] | null } | null
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
  /** 지금 앱의 판(app.getVersion). 깔린 뒤 다음에 열 때 알릴지 고른다. */
  appVersion: () => string
  /** 맥에 입력이 없던 초(powerMonitor.getSystemIdleTime). */
  idleSeconds: () => number
  /** 참이면 지금 깔지 않고 다음 쉬는 때로 미룬다. 앱을 끌 때도 깔지 않는다. 넘기지 않으면 미루지 않는다. */
  isBusy?: () => boolean
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

  const automatic = () => readSettings().autoUpdate !== false
  /** 저절로 깔려고 받아 둔 판. 쉬는 때를 기다린다. */
  let ready: string | null = null

  const installNow = () => {
    options.beforeInstall?.()
    autoUpdater.quitAndInstall(true, true)
  }

  /** 1분마다: 끌 때 깔기를 지금 상태에 맞추고, 쉬는 중이며 바쁘지 않으면 깐다.
   *  끌 때는 바쁜지 물을 틈이 없어서, 바쁜 동안은 끌 때 깔기를 미리 꺼 둔다(길어야 1분 늦게 따라간다). */
  const installIfIdle = () => {
    if (!automatic()) {
      ready = null
    }
    const free = !(options.isBusy?.() ?? false)
    autoUpdater.autoInstallOnAppQuit = ready !== null && free
    if (!ready || busy || !free || options.idleSeconds() < IDLE_INSTALL_SECONDS) {
      return
    }
    installNow()
  }

  const check = async (asked: boolean) => {
    if (busy) {
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
      // 「나중에」는 오늘은 다시 묻지 않는다는 뜻이다. 메뉴에서 직접 확인하면 같은 날에도 묻는다. 저절로 깔 때는 묻지 않으니 상관없다.
      if (!asked && !automatic() && readSettings().updateLaterOn === today()) {
        return
      }
      const version = result.updateInfo.version
      const language = options.locale() === 'ko' ? 'ko' : 'en'
      const notes = releaseNoteLines(result.updateInfo.releaseNotes, language)
      if (!asked && automatic()) {
        await autoUpdater.downloadUpdate()
        // 받는 사이 설정을 껐으면 묻는 쪽으로 넘어간다.
        if (automatic()) {
          writeSettings({ updateReady: { version, notes } })
          ready = version
          // 쉬는 때가 오기 전에 앱을 끄면 끌 때 깐다.
          autoUpdater.autoInstallOnAppQuit = !(options.isBusy?.() ?? false)
          return
        }
      }
      const answer = asked
        ? await askWhileDownloading(version, notes)
        : await askAfterDownload(version, notes)
      if (answer !== 'install') {
        writeSettings({ updateLaterOn: today() })
        return
      }
      installNow()
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
      // 받기는 이 파일이 직접 부른다(묻는 창에 받는 모습을 보이려고).
      autoUpdater.autoDownload = false
      // 「새 소식」에는 권하는 판의 내용만 보인다.
      autoUpdater.fullChangelog = false
      // 끌 때 깔기는 저절로 깔 판을 받아 둔 뒤에만 켠다.
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.on('error', (error: Error) => console.error('update:', error))
      // 저절로 깔린 뒤 처음 열 때 한 번만 알린다. 띄우는 순간 지워서 닫지 않고 앱을 꺼도 다시 뜨지 않는다.
      const done = readSettings().updateReady
      if (done && done.version === options.appVersion()) {
        writeSettings({ updateReady: null })
        askUpdate({ ...done, downloading: false, percent: 100, installed: true }, false)
      }
      setInterval(installIfIdle, IDLE_TICK_MS)
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
