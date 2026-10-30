import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import About from "./About";

// Why: the tray panel and the About window load the same page; the window label picks what it shows.
const label = getCurrentWindow().label;
document.documentElement.dataset.window = label;
const Page = label === "about" ? About : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
