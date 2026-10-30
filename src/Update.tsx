// The update question in Split's layout with the shared window values (runners-window.css; user decision
// `[RUNNERS] 네 앱 화면 값 통일` 2B): a 64 app icon centred on top, "A new version is available" and the one-line
// question centred under it, a "What's new" box (scrolls past five lines; hidden when the release has no notes in the
// agreed format), then [Later] [Install Now] across the full width. While a menu check is still downloading, a thick progress bar with "Downloading… 42%"
// stands where the buttons go, and the buttons take its place when the download is done. Enter installs, Escape is
// Later (during the download it only closes the window; the window comes back when the download is done). After
// Install Now the button reads "Installing…" and both stay off until the app quits. The same title, line and buttons as Split's update box.
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { answerUpdate, fitHeight, onUpdateOffer, updateOffer, type UpdateOffer } from "./native";
import appIcon from "./assets/app-icon.png";
import "./App.css";
import "./runners-window.css";
import "./Update.css";

export default function Update() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [installing, setInstalling] = useState(false);
  const root = useRef<HTMLElement>(null);
  const installButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Why: a list that goes on below the box fades out at the bottom, so the cut line reads as "scrolls", not as cut text.
  const [more, setMore] = useState(false);
  const measure = () => {
    const node = list.current;
    setMore(node !== null && node.scrollHeight - node.scrollTop - node.clientHeight > 1);
  };
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

  const notes = offer?.notes;
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [notes]);

  const percent = Math.max(0, Math.min(100, Math.floor(offer?.percent ?? 0)));
  return (
    <main className="update" ref={root}>
      <img className="update-icon" src={appIcon} alt="" draggable={false} />
      <h1 className="update-title">{t("update.title")}</h1>
      <p className="update-ask">{offer ? t("update.ask", { version: offer.version }) : " "}</p>
      {offer?.notes && (
        <section className="update-notes">
          <h2 className="update-notes-title">{t("update.notes")}</h2>
          <ul ref={list} className={`update-list${more ? " more" : ""}`} onScroll={measure}>
            {offer.notes.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {offer?.downloading ? (
        <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="update-progress-text">{t("update.downloading", { percent })}</span>
        </div>
      ) : (
        <div className="update-buttons">
          <button type="button" className="rw-button" disabled={installing} onClick={() => answerUpdate("later")}>
            {t("update.later")}
          </button>
          <button
            ref={installButton}
            type="button"
            className="rw-button default"
            disabled={!offer || offer.downloading || installing}
            onClick={install}
          >
            {installing ? t("update.installing") : t("update.install")}
          </button>
        </div>
      )}
    </main>
  );
}
