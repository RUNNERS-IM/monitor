// Monitor's About window, laid out like Split's: app icon, name, "version · free and open source", Website and
// GitHub buttons, the RUNNERS app cards, then "© RUNNERS · Open Source Notices", which opens the notices in a sheet
// (same layout as Split's). It replaces the native macOS about panel, which cannot hold the cards (shared spec in _docs/작업 가이드/공통.md).
import { useEffect, useMemo, useRef, useState } from "react";
import { RunnersApps } from "./components/RunnersApps";
import { loadRunnersAppGroups } from "./runnersApps";
import { locale, t } from "./i18n";
import { closeWindow, fitHeight, openExternal, version as appVersion } from "./native";
import appIcon from "./assets/app-icon.png";
import "./App.css";
import "./About.css";

// The window is 520 wide (electron/main/windows.ts); the height follows the content.
const WEBSITE = "https://runners.im/monitor";
const GITHUB = "https://github.com/RUNNERS-IM/monitor";

export default function About() {
  const [version, setVersion] = useState("");
  const [notices, setNotices] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const groups = useMemo(() => loadRunnersAppGroups("monitor"), []);

  useEffect(() => {
    appVersion().then(setVersion).catch(() => undefined);
    // Why: a debug run can open the notices sheet at launch (`VITE_MONITOR_EXPAND=notices`) so it can be captured.
    if (import.meta.env.DEV && import.meta.env.VITE_MONITOR_EXPAND === "notices") void openNotices(setNotices);
    // Why: a small utility window closes with Escape, like other macOS about windows.
    // Why: with the notices sheet open, Escape closes only the sheet, like a macOS sheet.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".notices")) setNotices(null);
      else closeWindow();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  // Why: descriptions wrap to one or two lines depending on the language, so the window grows or shrinks
  // to fit instead of cutting off the last card or leaving a gap.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const fit = () => fitHeight(Math.ceil(node.getBoundingClientRect().height));
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="about" ref={root}>
      <header className="about-header">
        <img className="about-icon" src={appIcon} alt="" draggable={false} />
        <h1 className="about-name">Monitor</h1>
        <p className="about-line">{version ? t("about.line", { version }) : " "}</p>
        <div className="about-links">
          <button type="button" className="about-link" onClick={() => void openExternal(WEBSITE)}>
            {t("about.website")}
          </button>
          <button type="button" className="about-link" onClick={() => void openExternal(GITHUB)}>
            GitHub
          </button>
        </div>
      </header>
      <RunnersApps groups={groups} locale={locale} onOpen={(url) => void openExternal(url)} />
      <footer className="about-credit">
        {t("about.license")} ·{" "}
        <button type="button" className="about-notices-link" onClick={() => void openNotices(setNotices)}>
          {t("about.notices")}
        </button>
      </footer>
      {notices !== null && <NoticesSheet text={notices} onClose={() => setNotices(null)} />}
    </main>
  );
}

/** Loads THIRD_PARTY_NOTICES.md only when asked, so the 600 KB of notices does not slow down opening the window. */
async function openNotices(show: (text: string) => void) {
  const file = await import("../THIRD_PARTY_NOTICES.md?raw");
  show(file.default);
}

/** Sheet over the About window, like Split's: title, scrolling notices with "#" lines in bold, and a Close button. */
function NoticesSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const blocks = useMemo(() => text.split(/\n(?=# )/), [text]);
  return (
    <div className="notices-backdrop" onClick={onClose}>
      <section className="notices" role="dialog" aria-modal="true" aria-labelledby="notices-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="notices-title" className="notices-title">
          {t("about.notices")}
        </h2>
        <div className="notices-body">
          {blocks.map((block, index) => {
            const [first, ...rest] = block.split("\n");
            const heading = first.startsWith("# ");
            return (
              <div key={index} className="notices-block">
                {heading ? <h3>{first.slice(2)}</h3> : <p>{first}</p>}
                <p>{rest.join("\n").trim()}</p>
              </div>
            );
          })}
        </div>
        <div className="notices-actions">
          <button type="button" className="notices-close" onClick={onClose}>
            {t("about.close")}
          </button>
        </div>
      </section>
    </div>
  );
}
