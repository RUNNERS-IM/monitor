// The Phone window: signs this computer in to the RUNNERS account, so the Monitor phone app (same account) can see it
// and act on it through the system server's relay. Signed in, it shows the account, whether the computer is on the
// relay, and Sign Out.
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { account, fitHeight, onAccount, reconnect, signIn, signOut, type AccountState } from "./native";
import "./App.css";
import "./runners-window.css";
import "./Account.css";

export default function Account() {
  const [state, setState] = useState<AccountState | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"wrong" | "network" | null>(null);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    void account().then(setState);
    return onAccount(setState);
  }, []);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(() => fitHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const failed = await signIn(email.trim(), password);
    setBusy(false);
    setProblem(failed);
    if (!failed) {
      setPassword("");
      setState(await account());
    }
  };

  if (!state) return <main className="account" ref={root} />;
  return (
    <main className="account" ref={root}>
      <h1 className="account-title">{t("phone.title")}</h1>
      <p className="account-note">{t("phone.note")}</p>
      {state.email ? (
        <>
          <div className="account-box">
            <div className="account-row">
              <span>{t("phone.account")}</span>
              <span className="account-value">{state.email}</span>
            </div>
            <div className="account-row">
              <span>{t("phone.status")}</span>
              <span className={`account-value status-${state.status}`}>{t(`phone.status.${state.status}`)}</span>
            </div>
          </div>
          {state.status === "elsewhere" && <p className="account-problem">{t("phone.elsewhereNote")}</p>}
          <div className="account-buttons">
            {state.status === "elsewhere" && (
              <button type="button" className="rw-button default" onClick={() => void reconnect()}>
                {t("phone.reconnect")}
              </button>
            )}
            <button type="button" className="rw-button" onClick={() => void signOut().then(() => account().then(setState))}>
              {t("phone.signOut")}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <div className="account-box">
            <input type="email" autoFocus required placeholder={t("phone.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input type="password" required placeholder={t("phone.password")} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {problem && <p className="account-problem">{t(`phone.problem.${problem}`)}</p>}
          <div className="account-buttons">
            <button type="submit" className="rw-button default" disabled={busy}>
              {t("phone.signIn")}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
