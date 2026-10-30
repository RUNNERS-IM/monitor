import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import About from "./About";
import Update from "./Update";
import { applyWindowLook, page } from "./native";

// Why: every window loads the same page; the address (#panel, #about or #update) picks what it shows.
document.documentElement.dataset.window = page;
applyWindowLook();
const Page = page === "about" ? About : page === "update" ? Update : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
