// The RUNNERS account in a desktop app's window, the same in Remote, Monitor, Split and Prompt (user decisions
// 「[REMOTE] 개발 - 네 앱 계정 · 연결 통일」 2A 4A and 「… 연결 요금 · 웹 · 세션 역할」 2A, 2026-11-05):
// - signed out, the app shows one Sign In button where its main content goes, and that button opens <SignInSheet>;
// - signed in, <AccountButton> is a round badge with the RUNNERS panda at the window's top right that opens the
//   account menu (the email, one line the app chooses, the app's own items, then Log Out).
// The source lives in runners-app-kit/desktop; each app copies this folder unchanged and runs check.mjs before it
// builds. It needs only React: the R mark and icons are drawn here, and the words come from runners-account-text.ts.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import panda from './assets/panda/face.webp'
import { TEXT, type TextKey } from './runners-account-text'
import './runners-account.css'

export type SignMode = 'login' | 'signup'

/** The code a failed call rejects with (as the Error's message): a wrong password, no account for the email, a password
 *  of the wrong shape, a taken email, a wrong emailed code, or too many tries. Anything else reads as "could not reach
 *  the server". main/account.ts makes these from the server's answers. */
export type SignInProblem = 'bad' | 'none' | 'format' | 'exists' | 'code' | 'many'

const PROBLEMS: readonly string[] = ['bad', 'none', 'format', 'exists', 'code', 'many']

/** What the emailed six-digit code is for: making the account or choosing a new password. */
export type CodePurpose = 'signup' | 'reset'

export type AccountMenuItem = {
  label: string
  icon?: ReactNode
  onSelect: () => void
}

type Lang = keyof typeof TEXT

/** The best of the 20 languages for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else English. */
function pickLang(tag: string): Lang {
  const codes = Object.keys(TEXT) as Lang[]
  const exact = codes.find((code) => code.toLowerCase() === tag.toLowerCase())
  if (exact) {
    return exact
  }
  const language = tag.split(/[-_]/)[0].toLowerCase()
  // Why: Taiwan, Hong Kong and Macau write traditional characters; every other Chinese tag reads simplified.
  if (language === 'zh') {
    return /-(hant|tw|hk|mo)\b/i.test(tag.replace(/_/g, '-')) ? 'zh-Hant' : 'zh-Hans'
  }
  return (codes as string[]).includes(language) ? (language as Lang) : 'en'
}

/** One of this folder's words in the language `lang` (any locale tag). */
export function accountText(lang: string, key: TextKey): string {
  return TEXT[pickLang(lang)][key]
}

/** The RUNNERS panda in the round account badge (user, 2026-11-08: no hair, eyebrows on every face). */
function BadgePanda() {
  return <img src={panda} alt="" draggable={false} />
}

/** The RUNNERS R mark on a rounded tile: a white tile with a black R in dark windows (user, 2026-11-05: 「다크모드에선
 *  화이트 + 검은 심볼」) and the reverse in light ones. */
export function RunnersMark(props: { size?: number }) {
  const tile = props.size ?? 44
  const height = Math.round(tile * 0.52)
  return (
    <span className="ra-mark" style={{ width: tile, height: tile }} role="img" aria-label="RUNNERS">
      <svg width={(height * 300) / 369} height={height} viewBox="0 0 300 369" aria-hidden>
        <path
          fill="currentColor"
          d="M288.293 125.279C288.293 147.416 282.592 167.106 271.191 184.449C259.789 201.69 244.52 215.972 225.585 227.297C232.915 237.396 240.448 247.088 247.981 256.474C255.514 265.757 262.64 274.735 269.155 283.304C275.772 291.874 281.676 299.832 286.868 307.177C292.06 314.522 296.437 321.153 300 326.968C296.131 340.537 289.006 350.943 278.826 358.186C268.646 365.429 257.041 369 244.214 369C235.663 369 228.334 367.979 222.124 366.041C215.915 364.103 210.519 361.348 205.837 357.88C201.154 354.411 196.878 350.126 193.01 345.025C189.141 339.924 185.477 334.518 182.015 328.702L132.541 248.823H101.696V362.471C97.421 363.593 90.8042 364.817 81.9479 365.939C72.9896 367.164 63.9295 367.674 54.6656 367.674C34.1025 367.674 19.8507 364.205 11.9104 357.166C3.97014 350.126 0 337.578 0 319.317V43.1537C0 34.9923 2.23957 28.6671 6.71868 24.1783C11.1978 19.6895 17.3057 16.1189 25.0424 13.3644C38.1744 8.67157 53.5458 5.30492 70.9534 3.16256C88.3609 1.02018 106.99 0 126.739 0C180.183 0 220.495 11.324 247.675 34.0741C274.855 56.8244 288.395 87.2254 288.395 125.279H288.293ZM129.59 171.289C145.877 171.289 159.213 167.514 169.698 159.965C180.183 152.415 185.375 141.193 185.375 126.502C185.375 111.812 180.59 100.59 171.123 93.0406C161.656 85.491 146.59 81.7165 126.026 81.7165C121.344 81.7165 116.966 81.9207 112.894 82.3286C108.823 82.7366 104.649 83.3487 100.373 84.063V171.492H129.488L129.59 171.289Z"
        />
      </svg>
    </span>
  )
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden {...STROKE}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden {...STROKE}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

/** The round badge at the window's top right and its menu. Shown only while signed in: signed out, the app's one
 *  Sign In button sits where its content goes, so there are never two. */
export function AccountButton(props: {
  lang: string
  account: string
  /** One line under the email, such as how many computers of the account are on. */
  line?: ReactNode
  items?: AccountMenuItem[]
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="ra-menu-box" ref={box}>
      <button
        type="button"
        className="ra-badge"
        aria-haspopup="menu"
        aria-expanded={open}
        title={props.account}
        onClick={() => setOpen(!open)}
      >
        <BadgePanda />
      </button>
      {open && (
        <div className="ra-menu" role="menu">
          <div className="ra-menu-head">
            <span className="ra-badge ra-large" aria-hidden>
              <BadgePanda />
            </span>
            <span className="ra-menu-text">
              <span className="ra-menu-email">{props.account}</span>
              <span className="ra-hint">{accountText(props.lang, 'title')}</span>
            </span>
          </div>
          {props.line && <div className="ra-menu-line ra-hint">{props.line}</div>}
          <div className="ra-menu-sep" />
          {props.items?.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="ra-menu-item"
              onClick={choose(item.onSelect)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="ra-menu-item"
            onClick={choose(props.onSignOut)}
          >
            <LogOutIcon />
            <span>{accountText(props.lang, 'signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

type Step = 'login' | 'signup' | 'signupCode' | 'forgot' | 'reset'

/** The system server's password rule (IsPasswordOrHash): letters and digits, 6 to 20, some symbols allowed. Checked
 *  here before a code is mailed, so a password of the wrong shape never costs a code. */
const PASSWORD_RULE = /^(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};:,.<>?|]{6,20}$/

/** The sign-in sheet over the window (user decisions 「[REMOTE] 개발 - 로그인 창 개선」 1A and the email check, 2026-11-07):
 *  - log in: email and password, "Forgot your password?" under the password, and when no account has that email a
 *    button that makes one with it;
 *  - make the account: email and password, then the six-digit code mailed to that email;
 *  - forgot: email, then the mailed code and a new password, which signs in (one password for the four apps).
 *  Each call resolves when done and rejects with an Error whose message is a SignInProblem or anything else. Without
 *  `sendCode` the sheet makes the account without the code step and offers no password reset. */
export function SignInSheet(props: {
  lang: string
  signIn: (mode: SignMode, email: string, password: string, code?: string) => Promise<unknown>
  sendCode?: (purpose: CodePurpose, email: string) => Promise<unknown>
  resetPassword?: (email: string, code: string, password: string) => Promise<unknown>
  onClose: () => void
}) {
  const text = (key: TextKey) => accountText(props.lang, key)
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const { onClose, sendCode, resetPassword } = props
  const canReset = !!sendCode && !!resetPassword

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  const go = (next: Step) => {
    setStep(next)
    setProblem(null)
    setResent(false)
    setCode('')
  }

  const run = (work: () => Promise<unknown>, then: () => void) => {
    setBusy(true)
    setProblem(null)
    setResent(false)
    work()
      .then(then)
      .catch((error: unknown) => {
        const said = error instanceof Error ? error.message : ''
        setProblem(PROBLEMS.includes(said) ? said : 'network')
      })
      .finally(() => setBusy(false))
  }

  const done = () => {
    setPassword('')
    onClose()
  }

  const ready =
    !!email &&
    (step === 'forgot' ||
      (step === 'signupCode'
        ? code.length === 6
        : step === 'reset'
          ? code.length === 6 && !!password
          : !!password))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) {
      return
    }
    if (step === 'login') {
      run(() => props.signIn('login', email, password), done)
    } else if ((step === 'signup' || step === 'reset') && !PASSWORD_RULE.test(password)) {
      setProblem('format')
    } else if (step === 'signup') {
      if (sendCode) {
        run(
          () => sendCode('signup', email),
          () => go('signupCode')
        )
      } else {
        run(() => props.signIn('signup', email, password), done)
      }
    } else if (step === 'signupCode') {
      run(() => props.signIn('signup', email, password, code), done)
    } else if (step === 'forgot' && sendCode) {
      run(
        () => sendCode('reset', email),
        () => {
          setPassword('')
          go('reset')
        }
      )
    } else if (step === 'reset' && resetPassword) {
      run(() => resetPassword(email, code, password), done)
    }
  }

  const resend = () => {
    if (sendCode && !busy) {
      run(
        () => sendCode(step === 'reset' ? 'reset' : 'signup', email),
        () => setResent(true)
      )
    }
  }

  const withEmail = (key: TextKey) => text(key).replace('{email}', email)
  const title: Record<Step, TextKey> = {
    login: 'sheetTitle',
    signup: 'sheetTitleSignUp',
    signupCode: 'codeTitle',
    forgot: 'forgotTitle',
    reset: 'forgotTitle'
  }
  const intro =
    step === 'signupCode'
      ? withEmail('codeIntro')
      : step === 'reset'
        ? withEmail('resetIntro')
        : step === 'forgot'
          ? text('forgotIntro')
          : text('sheetIntro')
  const codeStep = step === 'signupCode' || step === 'reset'
  const emailStep = step === 'login' || step === 'signup' || step === 'forgot'
  const passwordStep = step === 'login' || step === 'signup' || step === 'reset'
  const forgotLink = canReset && (
    <button className="ra-link ra-forgot" type="button" onClick={() => go('forgot')}>
      {text('forgot')}
    </button>
  )

  return (
    <div
      className="ra-cover"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form className="ra-sheet" onSubmit={submit} aria-label={text(title[step])}>
        <button type="button" className="ra-close" aria-label={text('close')} onClick={onClose}>
          <CloseIcon />
        </button>
        <RunnersMark />
        <div className="ra-title">{text(title[step])}</div>
        <div className="ra-hint ra-intro">{intro}</div>
        {emailStep && (
          <input
            key="email"
            className="ra-field"
            type="email"
            autoFocus
            autoComplete="email"
            placeholder={text('email')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
        {codeStep && (
          <input
            key="code"
            className="ra-field ra-code"
            type="text"
            inputMode="numeric"
            autoFocus
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={text('codeField')}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
        {passwordStep && (
          <input
            key={step === 'reset' ? 'new-password' : 'password'}
            className="ra-field"
            type="password"
            autoComplete={step === 'login' ? 'current-password' : 'new-password'}
            placeholder={text(step === 'reset' ? 'newPassword' : 'password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
        {(step === 'signup' || step === 'reset') && problem !== 'exists' && (
          <div className="ra-hint ra-rule">{text('passwordRule')}</div>
        )}
        {step === 'login' && forgotLink}
        {problem && <div className="ra-hint ra-error">{text(problem as TextKey)}</div>}
        {resent && <div className="ra-hint ra-note">{text('resent')}</div>}
        {problem === 'exists' ? (
          <>
            <button
              className="ra-submit"
              type="button"
              onClick={() => {
                setPassword('')
                go('login')
              }}
            >
              {text('signInThisEmail')}
            </button>
            {forgotLink}
          </>
        ) : problem === 'none' && step === 'login' ? (
          <>
            <button
              className="ra-submit"
              type="button"
              onClick={() => {
                setPassword('')
                go('signup')
              }}
            >
              {text('signUpThisEmail')}
            </button>
            <button className="ra-link" type="button" onClick={() => setProblem(null)}>
              {text('otherEmail')}
            </button>
          </>
        ) : (
          <>
            <button className="ra-submit" type="submit" disabled={!ready || busy}>
              {text(
                step === 'login'
                  ? 'signIn'
                  : step === 'forgot'
                    ? 'sendCode'
                    : step === 'reset'
                      ? 'resetSubmit'
                      : 'signUp'
              )}
            </button>
            {codeStep && (
              <button className="ra-link" type="button" disabled={busy} onClick={resend}>
                {text('resend')}
              </button>
            )}
            <button
              className="ra-link"
              type="button"
              onClick={() =>
                go(step === 'login' ? 'signup' : step === 'signupCode' ? 'signup' : 'login')
              }
            >
              {text(
                step === 'login'
                  ? 'toSignUp'
                  : step === 'signup'
                    ? 'toSignIn'
                    : step === 'signupCode'
                      ? 'otherEmail'
                      : 'backToSignIn'
              )}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
