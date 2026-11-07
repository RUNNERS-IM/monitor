// About 창: 앱 아이콘 · 이름 · 「판 · 무료 오픈소스」 · 웹사이트와 GitHub 단추 · 다른 앱 카드 · 오픈소스 고지.
// 쓰는 번역 열쇠: about.line({{version}}) · about.website · about.get · about.license · about.notices · about.close
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadRunnersAppGroups } from './runners-apps-data'
import { RunnersApps } from './runners-apps'
import './runners-window.css'
import './runners-about.css'

export type RunnersT = (key: string, args?: Record<string, string | number>) => string

export type RunnersAboutProps = {
  /** 목록에서 뺄 자기 앱 id. 예: monitor */
  appId: string
  /** 창에 보일 이름. 예: Monitor */
  appName: string
  appIcon: string
  website: string
  github: string
  locale: string
  t: RunnersT
  version: () => Promise<string>
  openExternal: (url: string) => void
  closeWindow: () => void
  fitHeight: (height: number) => void
  /** THIRD_PARTY_NOTICES.md 의 글자. 600 KB 나 되어 누를 때만 읽는다. */
  loadNotices: () => Promise<string>
  /** 개발 실행에서 고지 창을 연 모습을 찍을 때. */
  startWithNotices?: boolean
}

export function RunnersAbout(props: RunnersAboutProps) {
  const { appId, appName, appIcon, website, github, locale, t, openExternal, closeWindow } = props
  const { version: readVersion, fitHeight, loadNotices, startWithNotices } = props
  const [version, setVersion] = useState('')
  const [notices, setNotices] = useState<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const groups = useMemo(() => loadRunnersAppGroups(appId), [appId])

  useEffect(() => {
    readVersion()
      .then(setVersion)
      .catch(() => undefined)
    if (startWithNotices) {
      void loadNotices().then(setNotices)
    }
    // 작은 창은 Escape 로 닫는다. 고지 창이 열려 있으면 그것만 닫는다.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (document.querySelector('.notices')) {
        setNotices(null)
      } else {
        closeWindow()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [readVersion, loadNotices, startWithNotices, closeWindow])

  // 설명이 언어에 따라 한두 줄이 되므로, 카드가 잘리거나 빈 곳이 남지 않게 창 높이를 내용에 맞춘다.
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

  return (
    <main className="about" ref={root}>
      <header className="about-header">
        <img className="about-icon" src={appIcon} alt="" draggable={false} />
        <h1 className="about-name">{appName}</h1>
        <p className="about-line">{version ? t('about.line', { version }) : ' '}</p>
        <div className="about-links">
          <button type="button" className="about-link" onClick={() => openExternal(website)}>
            {t('about.website')}
          </button>
          <button type="button" className="about-link" onClick={() => openExternal(github)}>
            GitHub
          </button>
        </div>
      </header>
      <RunnersApps
        groups={groups}
        locale={locale}
        getLabel={t('about.get')}
        onOpen={openExternal}
      />
      <footer className="about-credit">
        {t('about.license')} ·{' '}
        <button
          type="button"
          className="about-notices-link"
          onClick={() => void loadNotices().then(setNotices)}
        >
          {t('about.notices')}
        </button>
      </footer>
      {notices !== null && (
        <NoticesSheet
          text={notices}
          title={t('about.notices')}
          closeLabel={t('about.close')}
          onClose={() => setNotices(null)}
        />
      )}
    </main>
  )
}

/** About 창 위에 뜨는 고지 창: 제목, 스크롤되는 고지(# 줄은 굵게), 닫기 단추. */
function NoticesSheet(props: {
  text: string
  title: string
  closeLabel: string
  onClose: () => void
}) {
  const { text, title, closeLabel, onClose } = props
  const blocks = useMemo(() => text.split(/\n(?=# )/), [text])
  return (
    <div className="notices-backdrop" onClick={onClose}>
      <section
        className="notices"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notices-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="notices-title" className="notices-title">
          {title}
        </h2>
        <div className="notices-body">
          {blocks.map((block) => {
            const [first, ...rest] = block.split('\n')
            return (
              <div key={first} className="notices-block">
                {first.startsWith('# ') ? <h3>{first.slice(2)}</h3> : <p>{first}</p>}
                <p>{rest.join('\n').trim()}</p>
              </div>
            )
          })}
        </div>
        <div className="notices-actions">
          <button type="button" className="notices-close" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
