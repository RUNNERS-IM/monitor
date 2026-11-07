// 메인 프로세스 쪽 업데이트 창. 창을 만드는 법은 앱이 넘겨 준다(크기 · 투명 효과 · preload 가 앱마다 다르다).
// 닫으면 「나중에」로 친다. 뜨자마자 1초 동안은 답을 받지 않는다. 다른 곳에 치던 Return 이나 클릭이 「지금 설치」로 잡힌 일이 있었다.
import type { UpdateAnswer, UpdateOffer, UpdatePrompt } from './updates'

const GUARD_MS = 1000

export type UpdateWindowLike = {
  isDestroyed: () => boolean
  close: () => void
  center: () => void
  show: () => void
  showInactive: () => void
  focus: () => void
  once: (event: 'ready-to-show', listener: () => void) => unknown
  on: (event: 'closed', listener: () => void) => unknown
  webContents: { send: (channel: string, value: unknown) => void }
}

export type UpdateWindowOptions = {
  /** 창을 만들어 업데이트 화면까지 불러 온다. show: false 로 만든다. */
  create: () => UpdateWindowLike
  /** 앱을 앞으로 가져온다(app.focus({ steal: true })). */
  focusApp: () => void
  /** 화면으로 상태를 보내는 통로 이름. 예: monitor:updateOffer */
  channel: string
}

export function createUpdateWindow(options: UpdateWindowOptions) {
  let current: {
    window: UpdateWindowLike
    offer: UpdateOffer
    answer: (answer: UpdateAnswer) => void
  } | null = null

  return {
    /** updates.ts 의 askUpdate 로 넘긴다. */
    askUpdate(offer: UpdateOffer, focus: boolean): UpdatePrompt {
      if (current && !current.window.isDestroyed()) {
        current.window.close()
      }
      let resolve!: (answer: UpdateAnswer) => void
      const answer = new Promise<UpdateAnswer>((done) => {
        resolve = done
      })
      const window = options.create()
      let answered = false
      let shownAt = Number.POSITIVE_INFINITY
      const mine = {
        window,
        offer: { ...offer },
        answer(value: UpdateAnswer) {
          // 닫는 것은 언제나 「나중에」이지만, 단추 답은 막 뜬 창에서 받지 않는다.
          if (Date.now() - shownAt < GUARD_MS) {
            return
          }
          // 설치 단추는 받는 중에 꺼져 있다. 이 줄은 Return 까지 막는다.
          if (answered || (value === 'install' && mine.offer.downloading)) {
            return
          }
          answered = true
          resolve(value)
          // 「지금 설치」 뒤에는 앱이 끝날 때까지 「설치 중」을 보여 준다.
          if (value === 'later' && !window.isDestroyed()) {
            window.close()
          }
        }
      }
      current = mine
      window.once('ready-to-show', () => {
        window.center()
        shownAt = Date.now()
        if (!focus) {
          window.showInactive()
          return
        }
        options.focusApp()
        window.show()
        window.focus()
      })
      window.on('closed', () => {
        if (current === mine) {
          current = null
        }
        if (!answered) {
          answered = true
          resolve('later')
        }
      })
      return {
        answer,
        set(change) {
          // 다 받은 순간 단추가 나타나므로 1초 막기를 다시 시작한다.
          if (mine.offer.downloading && change.downloading === false) {
            shownAt = Date.now()
          }
          mine.offer = { ...mine.offer, ...change }
          if (!window.isDestroyed()) {
            window.webContents.send(options.channel, mine.offer)
          }
        },
        close() {
          if (!window.isDestroyed()) {
            window.close()
          }
        }
      }
    },
    /** 화면이 처음 그릴 지금 상태. */
    offer: () => current?.offer ?? null,
    /** 화면에서 누른 답. */
    answer(value: UpdateAnswer) {
      current?.answer(value)
    }
  }
}
