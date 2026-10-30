// The update question, drawn like the menu (runners-menu.css): app icon, "A new version is available", the one-line
// question, a "What's new" box (scrolls past five lines; hidden when the release has no notes in the agreed format),
// a progress bar while the download runs (menu check only), then [Later] [Install Now]. Enter installs once the
// download is done, Escape is Later. After Install Now the button reads "Installing…" and both stay off until the
// app quits. The same title, line and buttons as Split's update box.
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { answerUpdate, fitHeight, onUpdateOffer, updateOffer, type UpdateOffer } from "./native";
import appIcon from "./assets/app-icon.png";
import "./runners-menu.css";
import "./App.css";
import "./Update.css";

export default function Update() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [installing, setInstalling] = useState(false);
  const root = useRef<HTMLElement>(null);
  const installButton = useRef<HTMLButtonElement>(null);
  // Why: the key handler is set up once, so it reads the latest state through refs.
  const ready = useRef(false);
  ready.current = offer !== null && !offer.downloading && !installing;
  const busy = useRef(false);
  busy.current = installing;

  const install = () => {
    if (!ready.current) return;
    setInstalling(true);
    answerUpdate("install");
  };

  useEffect(() => {
    void updateOffer().then((first) => setOffer((now) => now ?? first));
    const stop = onUpdateOffer(setOffer);
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current) answerUpdate("later");
      if (event.key === "Enter") {
        event.preventDefault();
        install();
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      stop();
      window.removeEventListener("keydown", keys);
    };
  }, []);

  // Why: when the download finishes, Install Now becomes the focused default, like a macOS alert's default button.
  const downloading = offer?.downloading ?? true;
  useEffect(() => {
    if (!downloading) installButton.current?.focus();
  }, [downloading]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(() => fitHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const percent = Math.max(0, Math.min(100, Math.floor(offer?.percent ?? 0)));
  return (
    <main className="update" ref={root}>
      <div className="update-head">
        <img className="update-icon" src={appIcon} alt="" draggable={false} />
        <div className="update-text">
          <h1 className="update-title">{t("update.title")}</h1>
          <p className="update-ask">{offer ? t("update.ask", { version: offer.version }) : " "}</p>
        </div>
      </div>
      {offer?.notes && (
        <section className="rm-group update-notes">
          <div className="rm-heading">{t("update.notes")}</div>
          <ul className="update-list">
            {offer.notes.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {offer?.downloading && (
        <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="meter-track">
            <div className="meter-fill update-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="update-progress-text">{t("update.downloading", { percent })}</div>
        </div>
      )}
      <div className="update-buttons">
        <button type="button" className="update-button" disabled={installing} onClick={() => answerUpdate("later")}>
          {t("update.later")}
        </button>
        <button
          ref={installButton}
          type="button"
          className="update-button default"
          disabled={!offer || offer.downloading || installing}
          onClick={install}
        >
          {installing ? t("update.installing") : t("update.install")}
        </button>
      </div>
    </main>
  );
}
