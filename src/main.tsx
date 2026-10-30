import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import About from "./About";
import { applyWindowLook, page } from "./native";

// Why: the tray panel and the About window load the same page; the address (#panel or #about) picks what it shows.
document.documentElement.dataset.window = page;
applyWindowLook();
const Page = page === "about" ? About : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
