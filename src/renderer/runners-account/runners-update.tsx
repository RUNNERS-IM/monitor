// 업데이트 창: 가운데 앱 아이콘, 제목과 묻는 말, 새 소식 칸(다섯 줄이 넘으면 스크롤, 약속한 글 모양이 아니면 숨김),
// 그 아래 [나중에] [지금 설치]. 메뉴에서 확인해 받는 중이면 단추 자리에 진행 막대가 있고, 다 받으면 단추로 바뀐다.
// Enter 는 설치, Escape 는 나중에(받는 중에는 창만 닫히고, 다 받으면 창이 다시 뜬다). 설치를 누르면 앱이 끝날 때까지 단추를 막는다.
// 저절로 깔린 뒤 처음 열 때는(offer.installed) 「○○ 로 업데이트했습니다」 한 줄과 [바뀐 점 보기] [확인] 만 있다. 새 소식은 누르면 펼친다.
// 쓰는 번역 열쇠: update.title · update.ask({{version}}) · update.notes · update.later · update.install · update.installing · update.downloading({{percent}})
//               update.done({{version}}) · update.showNotes · update.ok
import { useEffect, useRef, useState } from 'react'
import './runners-window.css'
import './runners-update.css'

export type RunnersUpdateOffer = {
  version: string
  notes: string[] | null
  downloading: boolean
  percent: number
  /** 참이면 저절로 깔린 뒤 처음 열 때의 「업데이트했습니다」 알림이다. */
  installed?: boolean
}

export type RunnersUpdateProps = {
  appIcon: string
  /** 어두운 화면에서 쓸 블랙 판. 주면 화면 밝기를 따라 바뀐다(2026-11-11 결정: Dock 은 화이트 판, 앱 안은 밝기를 따라감). */
  appIconDark?: string
  t: (key: string, args?: Record<string, string | number>) => string
  /** 창이 뜰 때 메인 프로세스에 있는 지금 상태. */
  offer: () => Promise<RunnersUpdateOffer | null>
  onOffer: (listener: (offer: RunnersUpdateOffer) => void) => () => void
  answer: (answer: 'install' | 'later') => void
  fitHeight: (height: number) => void
}

export function RunnersUpdate(props: RunnersUpdateProps) {
  const { appIcon, appIconDark, t, offer: readOffer, onOffer, answer, fitHeight } = props
  const [offer, setOffer] = useState<RunnersUpdateOffer | null>(null)
  const [installing, setInstalling] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const installed = offer?.installed === true
  const root = useRef<HTMLElement>(null)
  const installButton = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // 아래로 더 있는 목록은 끝이 흐려져서 「잘린 글」이 아니라 「스크롤」로 읽힌다.
  const [more, setMore] = useState(false)
  const measure = () => {
    const node = list.current
    setMore(node !== null && node.scrollHeight - node.scrollTop - node.clientHeight > 1)
  }
  // 키 처리는 한 번만 걸리므로 지금 상태를 ref 로 읽는다.
  const ready = useRef(false)
  ready.current = offer !== null && !offer.downloading && !installing
  const busy = useRef(false)
  busy.current = installing

  const install = () => {
    // 알림 창에서 Enter 는 닫기다.
    if (installed) {
      answer('later')
      return
    }
    if (!ready.current) {
      return
    }
    setInstalling(true)
    answer('install')
  }
  const installRef = useRef(install)
  installRef.current = install

  useEffect(() => {
    void readOffer().then((first) => setOffer((now) => now ?? first))
    const stop = onOffer(setOffer)
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy.current) {
        answer('later')
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        installRef.current()
      }
    }
    window.addEventListener('keydown', keys)
    return () => {
      stop()
      window.removeEventListener('keydown', keys)
    }
  }, [readOffer, onOffer, answer])

  // 다 받으면 「지금 설치」가 macOS 알림창의 기본 단추처럼 포커스를 받는다.
  const downloading = offer?.downloading ?? true
  useEffect(() => {
    if (!downloading) {
      installButton.current?.focus()
    }
  }, [downloading])

  useEffect(() => {
    const node = root.current
    if (!node) {
      return
    }
    const observer = new ResizeObserver(() =>
      fitHeight(Math.ceil(node.getBoundingClientRect().height))
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [fitHeight])

  const notes = offer?.notes
  useEffect(() => {
    const node = list.current
    if (!node) {
      return
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [notes, showNotes])

  // 새 소식은 한국어 아니면 영어다. 아랍어 화면에서 영어 줄의 마침표가 줄 맨 앞으로 가지 않게 방향을 정해 준다.
  const koreanNotes = notes?.some((line) => /[가-힣]/.test(line)) ?? false
  const percent = Math.max(0, Math.min(100, Math.floor(offer?.percent ?? 0)))
  return (
    <main className="update" ref={root}>
      <picture className="rw-picture">
        {appIconDark && <source srcSet={appIconDark} media="(prefers-color-scheme: dark)" />}
        <img className="update-icon" src={appIcon} alt="" draggable={false} />
      </picture>
      {installed ? (
        <h1 className="update-title">{t('update.done', { version: offer?.version ?? '' })}</h1>
      ) : (
        <>
          <h1 className="update-title">{t('update.title')}</h1>
          <p className="update-ask">{offer ? t('update.ask', { version: offer.version }) : ' '}</p>
        </>
      )}
      {notes && (!installed || showNotes) && (
        <section className="update-notes">
          <h2 className="update-notes-title">{t('update.notes')}</h2>
          <ul
            ref={list}
            className={`update-list${more ? ' more' : ''}`}
            lang={koreanNotes ? 'ko' : 'en'}
            dir={koreanNotes ? undefined : 'ltr'}
            onScroll={measure}
          >
            {notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {installed ? (
        <div className="update-buttons">
          {notes && !showNotes && (
            <button type="button" className="rw-button" onClick={() => setShowNotes(true)}>
              {t('update.showNotes')}
            </button>
          )}
          <button
            ref={installButton}
            type="button"
            className="rw-button default"
            onClick={() => answer('later')}
          >
            {t('update.ok')}
          </button>
        </div>
      ) : offer?.downloading ? (
        <div
          className="update-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="update-progress-text">{t('update.downloading', { percent })}</span>
        </div>
      ) : (
        <div className="update-buttons">
          <button
            type="button"
            className="rw-button"
            disabled={installing}
            onClick={() => answer('later')}
          >
            {t('update.later')}
          </button>
          <button
            ref={installButton}
            type="button"
            className="rw-button default"
            disabled={!offer || installing}
            onClick={install}
          >
            {installing ? t('update.installing') : t('update.install')}
          </button>
        </div>
      )}
    </main>
  )
}
