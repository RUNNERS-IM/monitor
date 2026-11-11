// About 창: 앱 아이콘 · 이름 · 「판 · 무료 오픈소스」 · 웹사이트와 GitHub 단추 · 다른 앱 카드 · 오픈소스 고지.
// 쓰는 번역 열쇠: about.line({{version}}) · about.website · about.get · about.license · about.notices · about.close
import { useEffect, useMemo, useRef, useState } from 'react'
import { accountText } from './runners-account'
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
  /** 창으로 띄울 때만 쓴다. 설정 탭 안(embedded)에서는 넘기지 않아도 된다. */
  closeWindow?: () => void
  /** 창으로 띄울 때만 쓴다. 설정 탭 안(embedded)에서는 넘기지 않아도 된다. */
  fitHeight?: (height: number) => void
  /** THIRD_PARTY_NOTICES.md 의 글자. 600 KB 나 되어 누를 때만 읽는다. */
  loadNotices: () => Promise<string>
  /** 개발 실행에서 고지 창을 연 모습을 찍을 때. */
  startWithNotices?: boolean
  /** 설정 창의 정보 탭처럼 다른 창 안에 넣을 때. 창 윗여백을 빼고 창 닫기 · 높이 맞추기를 하지 않는다. */
  embedded?: boolean
}

export function RunnersAbout(props: RunnersAboutProps) {
  const { appId, appName, appIcon, website, github, locale, t, openExternal, closeWindow } = props
  const { version: readVersion, fitHeight, loadNotices, startWithNotices, embedded } = props
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
        closeWindow?.()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [readVersion, loadNotices, startWithNotices, closeWindow])

  // 설명이 언어에 따라 한두 줄이 되므로, 카드가 잘리거나 빈 곳이 남지 않게 창 높이를 내용에 맞춘다.
  useEffect(() => {
    const node = root.current
    if (!node || embedded || !fitHeight) {
      return
    }
    const observer = new ResizeObserver(() =>
      fitHeight(Math.ceil(node.getBoundingClientRect().height))
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [fitHeight, embedded])

  return (
    <main className={embedded ? 'about about-embedded' : 'about'} ref={root}>
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
        <span dir="auto">{t('about.license')}</span> ·{' '}
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
          appName={appName}
          locale={locale}
          onClose={() => setNotices(null)}
        />
      )}
    </main>
  )
}

/** About 창 위에 뜨는 고지 창: 제목, 스크롤되는 고지(# 줄은 굵게), 닫기 단추.
 *  고지 파일(scripts/third-party-notices.mjs)은 영어로 쓰인다. 머리말 · 「License:」 같은 안내는 화면 언어로 바꾸고,
 *  라이선스 본문은 원문 그대로 둔다(2026-11-11 [DRAW] 개발 화면 점검). */
function NoticesSheet(props: {
  text: string
  title: string
  closeLabel: string
  appName: string
  locale: string
  onClose: () => void
}) {
  const { text, title, closeLabel, appName, locale, onClose } = props
  const blocks = useMemo(() => text.split(/\n(?=# )/), [text])
  // 고지 파일의 안내 줄을 화면 언어로. 알아보지 못한 줄은 null 을 돌려 원문대로 둔다.
  const guide = (line: string) => {
    const license = /^License: (.+)$/.exec(line)
    if (license) {
      return `${accountText(locale, 'noticesLicense')}: ${license[1]}`
    }
    if (line === 'The Apache License 2.0 text is at the end of this file.') {
      return accountText(locale, 'noticesApache')
    }
    const noFile =
      /^The package ships no license file\. Its license text and source are at (\S+)\.$/.exec(line)
    return noFile ? accountText(locale, 'noticesNoFile').replace('{url}', noFile[1]) : null
  }
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
        {/* Why: 고지 본문은 영어 원문이라 아랍어 화면에서도 왼쪽에서 오른쪽으로 읽어야 문장 부호가 뒤집히지 않는다.
            화면 언어로 바꾼 안내 줄만 dir="auto" 로 그 언어의 방향을 따른다. */}
        <div className="notices-body" dir="ltr">
          {blocks.map((block) => {
            const [first, ...rest] = block.split('\n')
            // 맨 앞 「# Third-Party Notices」 묶음은 창 제목과 같으니 제목 줄을 빼고 머리말만 화면 언어로 보인다.
            if (first === '# Third-Party Notices') {
              return (
                <div key={first} className="notices-block">
                  <p dir="auto">{accountText(locale, 'noticesIntro').replace('{app}', appName)}</p>
                </div>
              )
            }
            const lines = rest.join('\n').trim().split('\n')
            const lead = lines.findIndex((line) => line.trim() !== '' && guide(line) === null)
            const guides = (lead === -1 ? lines : lines.slice(0, lead)).filter((line) =>
              line.trim()
            )
            const body = lead === -1 ? '' : lines.slice(lead).join('\n')
            return (
              <div key={first} className="notices-block">
                {first.startsWith('# ') ? <h3>{first.slice(2)}</h3> : <p>{first}</p>}
                {guides.map((line) => (
                  <p key={line} dir="auto">
                    {guide(line)}
                  </p>
                ))}
                {body && <p>{body}</p>}
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
