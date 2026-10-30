// Monitor's About window, laid out like Split's: app icon, name, "version · free and open source", Website and
// GitHub buttons, the RUNNERS app cards, then the license and icon credit lines. It replaces the native macOS about panel, which cannot hold the cards (shared spec in _docs/작업 가이드/공통.md).
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RunnersApps } from "./components/RunnersApps";
import { loadRunnersAppGroups } from "./runnersApps";
import { locale, t } from "./i18n";
import appIcon from "../src-tauri/icons/128x128@2x.png";
import "./App.css";
import "./About.css";

// Same width as the window opened in src-tauri/src/about.rs; the height follows the content.
const WIDTH = 520;
const WEBSITE = "https://runners.im/monitor";
const GITHUB = "https://github.com/RUNNERS-IM/monitor";

export default function About() {
  const [version, setVersion] = useState("");
  const root = useRef<HTMLElement>(null);
  const groups = useMemo(() => loadRunnersAppGroups("monitor"), []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => undefined);
    invoke<boolean>("translucent").then((on) => {
      document.documentElement.dataset.translucent = String(on);
    });
    // Why: a small utility window closes with Escape, like other macOS about windows.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") getCurrentWindow().close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  // Why: descriptions wrap to one or two lines depending on the language, so the window grows or shrinks
  // to fit instead of cutting off the last card or leaving a gap.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    // Why: on macOS the title bar of this see-through window is counted inside the size Tauri sets, so the
    // window is grown by what the page is actually missing instead of being set to the content height.
    const fit = async () => {
      const missing = Math.ceil(node.getBoundingClientRect().height) - window.innerHeight;
      if (missing === 0) return;
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const inner = (await win.innerSize()).toLogical(scale);
      await win.setSize(new LogicalSize(WIDTH, inner.height + missing));
    };
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
          <button type="button" className="about-link" onClick={() => void openUrl(WEBSITE)}>
            {t("about.website")}
          </button>
          <button type="button" className="about-link" onClick={() => void openUrl(GITHUB)}>
            GitHub
          </button>
        </div>
      </header>
      <RunnersApps groups={groups} locale={locale} onOpen={(url) => void openUrl(url)} />
      <footer className="about-credit">
        <p>{t("about.license")}</p>
        <p>Icons: Lucide (ISC License)</p>
      </footer>
    </main>
  );
}
