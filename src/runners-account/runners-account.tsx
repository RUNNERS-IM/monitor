// The RUNNERS account in a desktop app's window, the same in Remote, Monitor, Split and Prompt (user decisions
// 「[REMOTE] 개발 - 네 앱 계정 · 연결 통일」 2A 4A and 「… 연결 요금 · 웹 · 세션 역할」 2A, 2026-11-05):
// - signed out, the app shows one Sign In button where its main content goes, and that button opens <SignInSheet>;
// - signed in, <AccountButton> is a round badge with the email's first letter at the window's top right that opens the
//   account menu (the email, one line the app chooses, the app's own items, then Log Out).
// The source lives in runners-app-kit/desktop; each app copies this folder unchanged and runs check.mjs before it
// builds. It needs only React: the R mark and icons are drawn here, and the words come from runners-account-text.ts.
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { TEXT, type TextKey } from "./runners-account-text";
import "./runners-account.css";

export type SignMode = "login" | "signup";

/** The code a failed `signIn` rejects with (as the Error's message): a wrong password, a taken email, or anything
 *  else, which the sheet shows as "could not reach the server". */
export type SignInProblem = "bad" | "exists";

export interface AccountMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

type Lang = keyof typeof TEXT;

/** The best of the 20 languages for a tag like `de-AT` or `zh-Hant-TW`: exact code, then language, else English. */
function pickLang(tag: string): Lang {
  const codes = Object.keys(TEXT) as Lang[];
  const exact = codes.find((code) => code.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const language = tag.split(/[-_]/)[0].toLowerCase();
  // Why: Taiwan, Hong Kong and Macau write traditional characters; every other Chinese tag reads simplified.
  if (language === "zh")
    return /-(hant|tw|hk|mo)\b/i.test(tag.replace(/_/g, "-"))
      ? "zh-Hant"
      : "zh-Hans";
  return (codes as string[]).includes(language) ? (language as Lang) : "en";
}

/** One of this folder's words in the language `lang` (any locale tag). */
export function accountText(lang: string, key: TextKey): string {
  return TEXT[pickLang(lang)][key];
}

/** The badge letter: the email's first letter or digit, upper case. */
function initial(email: string): string {
  return (email.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

/** The RUNNERS R mark on a rounded tile: a white tile with a black R in dark windows (user, 2026-11-05: 「다크모드에선
 *  화이트 + 검은 심볼」) and the reverse in light ones. */
export function RunnersMark(props: { size?: number }) {
  const tile = props.size ?? 44;
  const height = Math.round(tile * 0.52);
  return (
    <span
      className="ra-mark"
      style={{ width: tile, height: tile }}
      role="img"
      aria-label="RUNNERS"
    >
      <svg
        width={(height * 300) / 369}
        height={height}
        viewBox="0 0 300 369"
        aria-hidden
      >
        <path
          fill="currentColor"
          d="M288.293 125.279C288.293 147.416 282.592 167.106 271.191 184.449C259.789 201.69 244.52 215.972 225.585 227.297C232.915 237.396 240.448 247.088 247.981 256.474C255.514 265.757 262.64 274.735 269.155 283.304C275.772 291.874 281.676 299.832 286.868 307.177C292.06 314.522 296.437 321.153 300 326.968C296.131 340.537 289.006 350.943 278.826 358.186C268.646 365.429 257.041 369 244.214 369C235.663 369 228.334 367.979 222.124 366.041C215.915 364.103 210.519 361.348 205.837 357.88C201.154 354.411 196.878 350.126 193.01 345.025C189.141 339.924 185.477 334.518 182.015 328.702L132.541 248.823H101.696V362.471C97.421 363.593 90.8042 364.817 81.9479 365.939C72.9896 367.164 63.9295 367.674 54.6656 367.674C34.1025 367.674 19.8507 364.205 11.9104 357.166C3.97014 350.126 0 337.578 0 319.317V43.1537C0 34.9923 2.23957 28.6671 6.71868 24.1783C11.1978 19.6895 17.3057 16.1189 25.0424 13.3644C38.1744 8.67157 53.5458 5.30492 70.9534 3.16256C88.3609 1.02018 106.99 0 126.739 0C180.183 0 220.495 11.324 247.675 34.0741C274.855 56.8244 288.395 87.2254 288.395 125.279H288.293ZM129.59 171.289C145.877 171.289 159.213 167.514 169.698 159.965C180.183 152.415 185.375 141.193 185.375 126.502C185.375 111.812 180.59 100.59 171.123 93.0406C161.656 85.491 146.59 81.7165 126.026 81.7165C121.344 81.7165 116.966 81.9207 112.894 82.3286C108.823 82.7366 104.649 83.3487 100.373 84.063V171.492H129.488L129.59 171.289Z"
        />
      </svg>
    </span>
  );
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden {...STROKE}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden {...STROKE}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

/** The round badge at the window's top right and its menu. Shown only while signed in: signed out, the app's one
 *  Sign In button sits where its content goes, so there are never two. */
export function AccountButton(props: {
  lang: string;
  account: string;
  /** One line under the email, such as how many computers of the account are on. */
  line?: ReactNode;
  items?: AccountMenuItem[];
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

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
        {initial(props.account)}
      </button>
      {open && (
        <div className="ra-menu" role="menu">
          <div className="ra-menu-head">
            <span className="ra-badge ra-large" aria-hidden>
              {initial(props.account)}
            </span>
            <span className="ra-menu-text">
              <span className="ra-menu-email">{props.account}</span>
              <span className="ra-hint">
                {accountText(props.lang, "title")}
              </span>
            </span>
          </div>
          {props.line && (
            <div className="ra-menu-line ra-hint">{props.line}</div>
          )}
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
            <span>{accountText(props.lang, "signOut")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The sign-in sheet over the window: email and password, signing in or making the account. `signIn` resolves when
 *  signed in (the sheet then closes) and rejects with an Error whose message is a SignInProblem or anything else. */
export function SignInSheet(props: {
  lang: string;
  signIn: (mode: SignMode, email: string, password: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const text = (key: TextKey) => accountText(props.lang, key);
  const [mode, setMode] = useState<SignMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { onClose } = props;

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email || !password || busy) return;
    setBusy(true);
    setProblem(null);
    props
      .signIn(mode, email, password)
      .then(() => {
        setPassword("");
        onClose();
      })
      .catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "";
        setProblem(
          text(code === "bad" || code === "exists" ? code : "network"),
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="ra-cover"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="ra-sheet"
        onSubmit={submit}
        aria-label={text("sheetTitle")}
      >
        <button
          type="button"
          className="ra-close"
          aria-label={text("close")}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <RunnersMark />
        <div className="ra-title">
          {text(mode === "login" ? "sheetTitle" : "sheetTitleSignUp")}
        </div>
        <div className="ra-hint ra-intro">{text("sheetIntro")}</div>
        <input
          className="ra-field"
          type="email"
          autoFocus
          autoComplete="email"
          placeholder={text("email")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="ra-field"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={text("password")}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {problem && <div className="ra-hint ra-error">{problem}</div>}
        <button
          className="ra-submit"
          type="submit"
          disabled={!email || !password || busy}
        >
          {text(mode === "login" ? "signIn" : "signUp")}
        </button>
        <button
          className="ra-link"
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {text(mode === "login" ? "toSignUp" : "toSignIn")}
        </button>
      </form>
    </div>
  );
}
