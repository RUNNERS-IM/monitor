// The All Computers window: this computer and every other computer signed in to the same RUNNERS account, as cards.
// A card shows what the panel's summary rows show; choosing one shows below what can be done on it: what its panel
// suggests, quitting its apps, emptying its folders and pausing its runners, with the same relay commands the phones
// send (decision 2026-11-07 "[MONITOR] 개발 - 다른 컴퓨터 정리" 1A 2A 3B 4A 5A; it replaced 2026-11-02's look-only window).
// Every command is confirmed here first; nothing shows on the other computer.
// Signed out, the window holds one Sign In button and the shared sign-in sheet; signed in, the account badge sits at
// the top right (shared decision 2026-11-05 "네 앱 계정 · 연결 통일" 2A, parts copied from runners-app-kit/desktop).
import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanError, formatDuration, formatGb } from './format'
import { locale, t } from './i18n'
import * as native from './native'
import type {
  AccountState,
  CleanupKind,
  Emptied,
  Peer,
  PeerSuggestion,
  PeerUsage,
  QuitReport
} from './native'
import {
  AccountButton,
  RunnersMark,
  SignInSheet,
  type SignMode
} from './runners-account/runners-account'
import './runners-account/runners-window.css'
import './runners-account/runners-account.css'
import './Computers.css'

const REFRESH_MS = 2000

type Card = {
  /** Where commands go; null for this computer, whose own commands run here. */
  deviceId: string | null
  name: string
  self: boolean
  state: Peer['state']
  usage: PeerUsage | null
  at: number | null
}

const pct = (used: number, total: number) => (total > 0 ? Math.round((used * 100) / total) : 0)
const gb = formatGb
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const slowOf = (u: PeerUsage | null) => !!u && (u.slowMemory || u.slowCpu)
/** Why: the panel colours memory by macOS's pressure level, and a Mac uses most of its memory on purpose, so this
 *  window does the same; otherwise one Mac looked fine in the panel and slow here. */
const memoryTone = (u: PeerUsage) =>
  u.memoryPressure === 'critical' ? 'full' : u.memoryPressure === 'warn' ? 'high' : 'ok'

function Bar({ value, tone: given }: { value: number; tone?: 'ok' | 'high' | 'full' }) {
  const tone = given ?? (value >= 90 ? 'full' : value >= 75 ? 'high' : 'ok')
  return (
    <span className="c-bar">
      <i className={tone} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  )
}

function Line({
  label,
  value,
  bar,
  tone
}: {
  label: string
  value: string
  bar?: number
  tone?: 'ok' | 'high' | 'full'
}) {
  return (
    <div className="c-line">
      <span>{label}</span>
      {bar !== undefined && <Bar value={bar} tone={tone} />}
      <b>{value}</b>
    </div>
  )
}

function CardView({
  card,
  chosen,
  onChoose
}: {
  card: Card
  chosen: boolean
  onChoose: () => void
}) {
  const u = card.usage
  const status = u?.slowMemory ? t('status.slowMemory') : u?.slowCpu ? t('status.slowCpu') : null
  return (
    <button
      type="button"
      className={`c-card ${chosen ? 'chosen' : ''} ${u ? '' : 'off'}`}
      onClick={onChoose}
    >
      <div className="c-head">
        <span className="c-name">
          {card.self ? `${card.name} · ${t('computers.thisComputer')}` : card.name}
        </span>
        {status && <span className="c-badge">{status}</span>}
      </div>
      {u ? (
        <>
          <Line label={t('panel.cpu')} value={`${Math.round(u.cpuPercent)}%`} bar={u.cpuPercent} />
          <Line
            label={t('panel.memory')}
            value={`${pct(u.memoryUsed, u.memoryTotal)}%`}
            bar={pct(u.memoryUsed, u.memoryTotal)}
            tone={memoryTone(u)}
          />
          <Line
            label={t('panel.disk')}
            value={`${pct(u.diskUsed, u.diskTotal)}%`}
            bar={pct(u.diskUsed, u.diskTotal)}
          />
          {card.state === 'noAnswer' && (
            <div className="c-off">
              {card.at
                ? t('computers.noAnswerSince', { time: clock(card.at) })
                : t('computers.noAnswer')}
            </div>
          )}
        </>
      ) : (
        <div className="c-off">
          {card.state === 'offline' ? t('computers.offline') : t('computers.noAnswer')}
        </div>
      )}
    </button>
  )
}

/** One thing a button does on a computer: what is sent, and what the confirm sheet says. */
type Action = {
  key: string
  command: 'app.quit' | 'cleanup.empty' | 'runner.pause' | 'runner.resume'
  args: Record<string, unknown>
  /** What the result line starts with: the app, folder kind or runner. */
  what: string
  label: string
  busy: string
  title: string
  detail?: string
  quitKind?: 'app' | 'process'
}

const quitAction = (name: string, kind: 'app' | 'process', remote: boolean): Action => ({
  key: `quit:${name}`,
  command: 'app.quit',
  args: { name },
  what: name,
  label: t('slow.quit'),
  busy: t('quit.running'),
  title: t('suggest.quit', { name }),
  // Why: ⌘Q lets an app ask to save first, and that question shows on the other computer's screen, not here.
  detail:
    kind === 'app'
      ? `${t('slow.quitNote')}${remote ? ` ${t('computers.quitNoteRemote')}` : ''}`
      : t('slow.quitNoteProcess'),
  quitKind: kind
})

const emptyAction = (kind: CleanupKind, bytes: number): Action => ({
  key: `empty:${kind}`,
  command: 'cleanup.empty',
  args: { kind },
  what: t(`disk.${kind}`),
  label: t('empty.button'),
  busy: t('empty.running'),
  title: t(`empty.confirm.${kind}`, { size: gb(bytes) }),
  detail: t(`empty.detail.${kind}`)
})

const runnerAction = (runner: NonNullable<PeerUsage['runners']>[number]): Action =>
  runner.pausedUntil
    ? {
        key: `resume:${runner.name}`,
        command: 'runner.resume',
        args: { name: runner.name },
        what: runner.name,
        label: t('runner.resume'),
        busy: t('runner.resume'),
        title: `${runner.name} · ${t('runner.resume')}`
      }
    : {
        key: `pause:${runner.name}`,
        command: 'runner.pause',
        args: { name: runner.name },
        what: runner.name,
        label: runner.busy ? t('runner.pauseConfirm') : t('runner.pause'),
        busy: t('runner.pause'),
        title: `${runner.name} · ${t('runner.pause')}`,
        detail: runner.busy ? t('runner.pauseBusyNote') : undefined
      }

const suggestionAction = (s: PeerSuggestion, remote: boolean): Action =>
  s.action === 'quit' ? quitAction(s.name, s.quit, remote) : emptyAction(s.kind, s.bytes)

/** The suggestion's line, worded as in the panel. */
function suggestionText(s: PeerSuggestion): { what: string; why: string } {
  if (s.action === 'empty') {
    return {
      what: t('suggest.empty', { kind: t(`disk.${s.kind}`) }),
      why: t('suggest.emptyWhy', { size: gb(s.bytes) })
    }
  }
  return {
    what: s.devServer
      ? t('suggest.quitDev', { name: s.name })
      : t('suggest.quit', { name: s.name }),
    why: [
      s.runningSecs != null
        ? t('suggest.running', { time: formatDuration(s.runningSecs) })
        : t('suggest.unused'),
      s.reason === 'cpu'
        ? t('suggest.cpu', { percent: Math.round(s.cpuPercent) })
        : t('suggest.frees', { size: gb(s.bytes) })
    ].join(' · ')
  }
}

function resultText(action: Action, data: unknown): string {
  if (action.command === 'app.quit') {
    const report = data as Partial<QuitReport>
    return [
      report.gone ? t('quit.gone') : t(action.quitKind === 'app' ? 'quit.stillApp' : 'quit.still'),
      report.alreadyGone ? t('quit.alreadyGone', { count: report.alreadyGone }) : null,
      report.failed?.length ? t('quit.failed', { count: report.failed.length }) : null
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (action.command === 'cleanup.empty') {
    const done = data as Emptied
    const freed = t('empty.done', { size: gb(done.freed) })
    return done.skipped > 0
      ? `${freed} ${t(done.keptReason === 'recent' ? 'empty.skipped' : 'empty.skippedInUse', { count: done.skipped })}`
      : freed
  }
  return action.command === 'runner.pause' ? t('runner.pause') : t('runner.resume')
}

function ActButton({
  action,
  busy,
  onPress
}: {
  action: Action
  busy: boolean
  onPress: (action: Action) => void
}) {
  return (
    <button
      type="button"
      className="c-act"
      data-act={action.key}
      disabled={busy}
      onClick={() => onPress(action)}
    >
      {busy ? action.busy : action.command === 'runner.pause' ? t('runner.pause') : action.label}
    </button>
  )
}

/** Asks before anything runs, with the computer's name on top so the wrong card is not acted on. */
function ConfirmSheet({
  card,
  action,
  onCancel,
  onGo
}: {
  card: Card
  action: Action
  onCancel: () => void
  onGo: () => void
}) {
  return (
    <div
      className="ra-cover"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div className="ra-sheet c-confirm" role="alertdialog" aria-label={action.title}>
        <span className="c-confirm-on">
          {card.self ? `${card.name} · ${t('computers.thisComputer')}` : card.name}
        </span>
        <div className="ra-title">{action.title}</div>
        {action.detail && <div className="ra-hint">{action.detail}</div>}
        <div className="c-confirm-buttons">
          <button type="button" className="rw-button c-confirm-cancel" autoFocus onClick={onCancel}>
            {t('empty.cancel')}
          </button>
          <button type="button" className="rw-button default c-confirm-go" onClick={onGo}>
            {action.label}
          </button>
        </div>
      </div>
    </div>
  )
}

type Outcome = { text: string; failed: boolean }

function Detail({
  card,
  running,
  outcome,
  onPress
}: {
  card: Card
  running: Set<string>
  outcome: Outcome | undefined
  onPress: (action: Action) => void
}) {
  const u = card.usage
  if (!u) {
    return null
  }
  const runners =
    u.runnersBusy > 0
      ? t('summary.runnersBusy', { count: u.runnersBusy })
      : t('summary.runnersIdle', { count: u.runnersIdle })
  // Why: an older Monitor answers the numbers but turns commands away, so its card says what to do instead (4A).
  const old = !card.self && !u.hostCommands
  const can = card.state === 'ok' && !old
  const remote = !card.self
  const busy = (action: Action) => running.has(`${card.deviceId}:${action.key}`)
  // Why: terminals, editors and node that is not a known dev server are never offered, as in the panel (5A).
  const noQuit = u.topMemory.filter((app) => !app.quit)
  const kinds = (u.cleanupKinds ?? []).filter((part) => part.bytes > 0)
  const suggested = u.suggestions ?? []
  return (
    <section className="c-detail">
      <div className="c-detail-head">
        <b>{card.name}</b>
        <span>
          {u.os} · Monitor {u.version}
          {card.at && !card.self ? ` · ${t('computers.seen', { time: clock(card.at) })}` : ''}
        </span>
      </div>
      {old && card.state === 'ok' && <div className="c-old">{t('computers.oldMonitor')}</div>}
      {outcome && (
        <div className={`c-outcome ${outcome.failed ? 'failed' : ''}`}>{outcome.text}</div>
      )}
      {can && suggested.length > 0 && (
        <div className="c-suggest">
          <div className="c-sec">{t('suggest.title')}</div>
          {suggested.map((item) => {
            const action = suggestionAction(item, remote)
            const { what, why } = suggestionText(item)
            return (
              <div key={action.key} className="c-line">
                <span>
                  <em>{what}</em> · {why}
                </span>
                <ActButton action={action} busy={busy(action)} onPress={onPress} />
              </div>
            )
          })}
        </div>
      )}
      <div className="c-cols">
        <div>
          <div className="c-sec">{t('computers.apps')}</div>
          {u.topMemory.map((app) => {
            const action = app.quit ? quitAction(app.name, app.quit, remote) : null
            return (
              <div key={app.name} className="c-line">
                <span>{app.name}</span>
                <b>{gb(app.memory)}</b>
                {can && action && (
                  <ActButton action={action} busy={busy(action)} onPress={onPress} />
                )}
              </div>
            )
          })}
          {can && noQuit.length > 0 && (
            <div className="c-why">
              {t('computers.noQuit', { names: noQuit.map((app) => app.name).join(', ') })}
            </div>
          )}
          {can && (u.runners ?? []).length > 0 && (
            <>
              <div className="c-sec c-sec-gap">{t('panel.runner')}</div>
              {(u.runners ?? []).map((runner) => {
                const action = runnerAction(runner)
                return (
                  <div key={runner.name} className="c-line">
                    <span>{runner.name}</span>
                    <b>
                      {runner.off
                        ? t('runner.off')
                        : runner.pausedUntil
                          ? t('runner.paused', { time: clock(runner.pausedUntil) })
                          : t(runner.busy ? 'runner.busy' : 'runner.idle')}
                    </b>
                    {!runner.off && (
                      <ActButton action={action} busy={busy(action)} onPress={onPress} />
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
        <div>
          <div className="c-sec">&nbsp;</div>
          <Line label={t('panel.memory')} value={`${gb(u.memoryUsed)} / ${gb(u.memoryTotal)}`} />
          <Line
            label={t('panel.disk')}
            value={`${gb(u.diskTotal - u.diskUsed)} · ${t('computers.free')}`}
          />
          <Line
            label={t('panel.work')}
            value={`${t('summary.claude', { count: u.claudeSessions })} · ${runners}`}
          />
          <Line
            label={t('panel.cleanup')}
            value={u.cleanable === null ? t('panel.cleanupMeasuring') : gb(u.cleanable)}
          />
          {can &&
            kinds.map((part) => {
              const action = emptyAction(part.kind, part.bytes)
              return (
                <div key={part.kind} className="c-line c-sub">
                  <span>{t(`disk.${part.kind}`)}</span>
                  <b>{gb(part.bytes)}</b>
                  <ActButton action={action} busy={busy(action)} onPress={onPress} />
                </div>
              )
            })}
        </div>
      </div>
    </section>
  )
}

/** The account badge's second line: how many of the account's computers are on, or how the connection stands. */
function AccountLine({ state, others }: { state: AccountState; others: Card[] }) {
  if (state.status !== 'connected') {
    return <>{t(`account.status.${state.status === 'elsewhere' ? 'elsewhere' : 'connecting'}`)}</>
  }
  return (
    <>{t('account.online', { count: 1 + others.filter((c) => c.state !== 'offline').length })}</>
  )
}

export default function Computers() {
  const [cards, setCards] = useState<Card[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [state, setState] = useState<AccountState | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [asking, setAsking] = useState<{ card: Card; action: Action } | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const askingRef = useRef(asking)
  askingRef.current = asking
  useEffect(() => {
    void native.account().then(setState)
    const stop = native.onAccount(setState)
    // Why: the panel's account line opens this window to sign in, so the sheet comes up at once.
    void native.takeSignIn().then((wanted) => wanted && setSigningIn(true))
    const stopSignIn = native.onSignIn(() => {
      void native.takeSignIn()
      setSigningIn(true)
    })
    return () => {
      stop()
      stopSignIn()
    }
  }, [])
  useEffect(() => {
    let alive = true
    const read = async () => {
      const [self, peers] = await Promise.all([native.selfUsage(), native.peers()])
      if (!alive) {
        return
      }
      const mine: Card[] = self
        ? [
            {
              deviceId: null,
              name: self.host,
              self: true,
              state: 'ok',
              usage: self,
              at: Date.now()
            }
          ]
        : []
      setCards([...mine, ...peers.map((p) => ({ ...p, self: false }))])
    }
    void read()
    const timer = setInterval(() => void read(), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    // Why: Escape closes the sign-in sheet first (the sheet listens itself), then the confirm sheet, then the window.
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || signingIn) {
        return
      }
      if (askingRef.current) {
        setAsking(null)
      } else {
        native.closeWindow()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [signingIn])
  const signIn = useCallback(async (mode: SignMode, email: string, password: string) => {
    const problem = await native.signIn(mode, email, password)
    if (problem) {
      throw new Error(problem)
    }
    setState(await native.account())
  }, [])
  const closeSignIn = useCallback(() => setSigningIn(false), [])
  const go = useCallback(({ card, action }: { card: Card; action: Action }) => {
    const id = `${card.deviceId}:${action.key}`
    const where = String(card.deviceId)
    setAsking(null)
    setRunning((now) => new Set(now).add(id))
    native
      .computerCommand(card.deviceId, action.command, action.args)
      .then((data) =>
        setOutcomes((now) => ({
          ...now,
          [where]: { text: `${action.what} · ${resultText(action, data)}`, failed: false }
        }))
      )
      .catch((error: unknown) =>
        setOutcomes((now) => ({
          ...now,
          [where]: {
            text: `${action.what} · ${t('action.failed', { error: cleanError(error) })}`,
            failed: true
          }
        }))
      )
      .finally(() =>
        setRunning((now) => {
          const next = new Set(now)
          next.delete(id)
          return next
        })
      )
  }, [])
  // Why: with nothing chosen yet, the first slow computer (or this one) is shown, so the window opens on something useful.
  const current =
    cards.find((c) => c.name === chosen) ?? cards.find((c) => slowOf(c.usage)) ?? cards[0]
  const signedOut = state !== null && !state.email
  return (
    <main className="computers">
      <header className="c-head-row">
        <div>
          <h1>{t('computers.title')}</h1>
          <p className="c-note">{t('computers.note')}</p>
        </div>
        {state?.email && (
          <AccountButton
            lang={locale}
            account={state.email}
            line={<AccountLine state={state} others={cards.filter((c) => !c.self)} />}
            items={
              state.status === 'elsewhere'
                ? [{ label: t('account.reconnect'), onSelect: () => void native.reconnect() }]
                : []
            }
            onSignOut={() => void native.signOut().then(() => native.account().then(setState))}
          />
        )}
      </header>
      {signedOut && (
        <section className="c-signed-out">
          <RunnersMark size={28} />
          <b>{t('computers.signedOutTitle')}</b>
          <p className="c-note">{t('computers.signedOutNote')}</p>
          <button type="button" className="rw-button default" onClick={() => setSigningIn(true)}>
            {t('account.signIn')}
          </button>
        </section>
      )}
      {state?.status === 'elsewhere' && <p className="c-note">{t('account.elsewhereNote')}</p>}
      {state?.email && cards.length <= 1 && <p className="c-note">{t('computers.empty')}</p>}
      <div className="c-grid">
        {cards.map((card, i) => (
          <CardView
            key={`${card.name}-${i}`}
            card={card}
            chosen={card === current}
            onChoose={() => setChosen(card.name)}
          />
        ))}
      </div>
      {current && (
        <Detail
          card={current}
          running={running}
          outcome={outcomes[String(current.deviceId)]}
          onPress={(action) => setAsking({ card: current, action })}
        />
      )}
      {asking && (
        <ConfirmSheet
          card={asking.card}
          action={asking.action}
          onCancel={() => setAsking(null)}
          onGo={() => go(asking)}
        />
      )}
      {signingIn && <SignInSheet lang={locale} signIn={signIn} onClose={closeSignIn} />}
    </main>
  )
}
