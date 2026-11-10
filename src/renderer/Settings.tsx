// The Settings window: one window for everything that is not the panel, in Split's Settings look (tabs in the
// toolbar at the top). Tabs: Computers (the most used screen, first), General, Account, About
// (shared decision 2026-11-07, Monitor 1A). The panel's account line and ⌘, open it; `?tab=` picks the first tab.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleUser, Info, Laptop, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'
import Computers from './Computers'
import { locale, t } from './i18n'
import * as native from './native'
import type { AccountState, MenuCommand, MenuState, SettingsTab } from './native'
import appIcon from './assets/app-icon.png'
import { RunnersAbout, type RunnersT } from './runners-account/runners-about'
import panda from './runners-account/assets/panda/face.webp'
import { accountText } from './runners-account/runners-account'
import { SignIn } from './SignIn'
import './runners-account/runners-window.css'
import './runners-account/runners-account.css'
import './Settings.css'

const TABS: { id: SettingsTab; label: Parameters<typeof t>[0]; Icon: LucideIcon }[] = [
  { id: 'computers', label: 'settings.tabComputers', Icon: Laptop },
  { id: 'general', label: 'settings.tabGeneral', Icon: SettingsIcon },
  { id: 'account', label: 'settings.tabAccount', Icon: CircleUser },
  { id: 'about', label: 'settings.tabAbout', Icon: Info }
]
const mac = navigator.userAgent.includes('Macintosh')
const open = (url: string) => void native.openExternal(url)
// Why: 고지는 600 KB 나 되어 누를 때만 읽는다.
const loadNotices = () => import('../../THIRD_PARTY_NOTICES.md?raw').then((file) => file.default)

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      className={on ? 'switch on' : 'switch'}
      onClick={onChange}
    >
      <span className="switch-knob" />
    </button>
  )
}

function Row({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="s-row">
      <div className="s-row-line">
        <div className="s-row-text">
          <span className="s-row-title">{title}</span>
          {hint && <span className="s-row-hint">{hint}</span>}
        </div>
        <div className="s-row-space" />
        <div className="s-row-control">{children}</div>
      </div>
    </div>
  )
}

/** Split's question before the icon goes: hiding it leaves only the Applications folder as a way back. */
function HideAsk({ onCancel, onHide }: { onCancel: () => void; onHide: () => void }) {
  return (
    <div
      className="ra-cover"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div className="ra-sheet s-ask" role="alertdialog" aria-label={t('general.hideAsk')}>
        <img className="s-ask-icon" src={appIcon} alt="" draggable={false} />
        <div className="ra-title">{t('general.hideAsk')}</div>
        <div className="ra-hint">{t('general.trayIconHint')}</div>
        <div className="s-ask-buttons">
          <button type="button" className="rw-button" autoFocus onClick={onCancel}>
            {t('general.cancel')}
          </button>
          <button type="button" className="rw-button default" onClick={onHide}>
            {t('general.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}

function General() {
  const [state, setState] = useState<MenuState | null>(null)
  const [asking, setAsking] = useState(false)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void native.menuState().then(setState)
    void native.version().then(setVersion)
  }, [])
  useEffect(() => {
    // Why: Escape takes back the question first, then closes the window, as on the Computers and About tabs.
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (asking) {
          setAsking(false)
        } else {
          native.closeWindow()
        }
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [asking])
  const run = (name: MenuCommand) => void native.command(name).then(setState)
  return (
    <main className="s-content">
      <section className="s-section">
        <h2 className="s-section-title">{t('general.section')}</h2>
        <div className="s-card">
          <Row title={t('menu.openAtLogin')} hint={t('general.openAtLoginHint')}>
            <Switch
              label={t('menu.openAtLogin')}
              on={!!state?.openAtLogin}
              onChange={() => run('login')}
            />
          </Row>
          <div className="s-card-separator" />
          <Row title={t('menu.autoUpdate')} hint={t('general.autoUpdateHint')}>
            <Switch
              label={t('menu.autoUpdate')}
              on={!!state?.autoUpdate}
              onChange={() => run('autoUpdate')}
            />
          </Row>
          {state?.canHideIcon && (
            <>
              <div className="s-card-separator" />
              <Row title={t('general.trayIcon')} hint={t('general.trayIconHint')}>
                <Switch
                  label={t('general.trayIcon')}
                  on={state.trayIcon}
                  onChange={() => (state.trayIcon ? setAsking(true) : run('trayIcon'))}
                />
              </Row>
            </>
          )}
          <div className="s-card-separator" />
          {/* Why: the panel's bottom lines are only Settings, Help and Quit now, so the update check lives here,
              next to the version it would replace. */}
          <Row title={`Monitor ${version}`}>
            <button type="button" className="rw-button" onClick={() => run('updates')}>
              {t('menu.checkUpdates')}
            </button>
          </Row>
        </div>
      </section>
      {asking && (
        <HideAsk
          onCancel={() => setAsking(false)}
          onHide={() => {
            setAsking(false)
            run('trayIcon')
          }}
        />
      )}
    </main>
  )
}

function Account() {
  const [state, setState] = useState<AccountState | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  useEffect(() => {
    void native.account().then(setState)
    return native.onAccount(setState)
  }, [])
  useEffect(() => {
    // Why: while the sign-in sheet is up it takes Escape itself.
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !signingIn) {
        native.closeWindow()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [signingIn])
  const signedIn = useCallback(() => void native.account().then(setState), [])
  const closeSignIn = useCallback(() => setSigningIn(false), [])
  const email = state?.email
  return (
    <main className="s-content">
      <section className="s-section">
        <h2 className="s-section-title">{accountText(locale, 'title')}</h2>
        <div className="s-card">
          {email ? (
            <div className="s-row">
              <div className="s-row-line">
                <span className="ra-badge ra-large" aria-hidden>
                  <img src={panda} alt="" draggable={false} />
                </span>
                <div className="s-row-text">
                  <span className="s-row-title">{email}</span>
                  <span className="s-row-hint">
                    {t(
                      `account.status.${state.status === 'signedOut' ? 'connecting' : state.status}`
                    )}
                  </span>
                </div>
                <div className="s-row-space" />
                {state.status === 'elsewhere' && (
                  <button
                    type="button"
                    className="rw-button"
                    onClick={() => void native.reconnect()}
                  >
                    {t('account.reconnect')}
                  </button>
                )}
                <button
                  type="button"
                  className="rw-button"
                  onClick={() => void native.signOut().then(signedIn)}
                >
                  {accountText(locale, 'signOut')}
                </button>
              </div>
            </div>
          ) : (
            state && (
              <Row title={t('settings.signedOut')} hint={t('settings.signedOutHint')}>
                <button
                  type="button"
                  className="rw-button default"
                  onClick={() => setSigningIn(true)}
                >
                  {t('account.signIn')}
                </button>
              </Row>
            )
          )}
        </div>
        {state?.status === 'elsewhere' && (
          <p className="s-section-hint">{t('account.elsewhereNote')}</p>
        )}
        <p className="s-section-hint">{accountText(locale, 'sheetIntro')}</p>
      </section>
      {signingIn && <SignIn onSignedIn={signedIn} onClose={closeSignIn} />}
    </main>
  )
}

function About() {
  const { t: translate } = useTranslation()
  return (
    <div className="settings-about">
      <RunnersAbout
        appId="monitor"
        appName="Monitor"
        appIcon={appIcon}
        website="https://runners.im/monitor"
        github="https://github.com/RUNNERS-IM/monitor"
        locale={locale}
        t={translate as RunnersT}
        version={native.version}
        openExternal={open}
        closeWindow={native.closeWindow}
        embedded
        loadNotices={loadNotices}
      />
    </div>
  )
}

export default function Settings() {
  const first = new URLSearchParams(location.search).get('tab')
  const [tab, setTab] = useState<SettingsTab>(TABS.find((x) => x.id === first)?.id ?? TABS[0].id)
  useEffect(() => native.onSettingsTab(setTab), [])
  return (
    <div className="window">
      {mac && <header className="titlebar">{t('settings.title')}</header>}
      <nav className="toolbar" role="tablist" aria-label={t('settings.title')}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'toolbar-item selected' : 'toolbar-item'}
            onClick={() => setTab(id)}
          >
            <Icon size={22} strokeWidth={1.5} aria-hidden />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {tab === 'computers' && <Computers />}
        {tab === 'general' && <General />}
        {tab === 'account' && <Account />}
        {tab === 'about' && <About />}
      </div>
    </div>
  )
}
