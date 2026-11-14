import * as Sentry from '@sentry/electron/renderer'
import { startErrorReport } from './runners-account/error-report'
// Why: 화면 오류는 main 으로 넘겨 보내므로 판 이름(release)은 main 의 것을 쓴다. DSN 이 비면 아무것도 하지 않는다.
startErrorReport(Sentry, { dsn: import.meta.env.VITE_SENTRY_DSN })
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Settings from './Settings'
import Update from './Update'
import Computers from './Computers'
import { applyWindowLook, page } from './native'

// Why: every window loads the same page; the address (#panel, #settings, #update or #computers) picks what it shows.
document.documentElement.dataset.window = page
applyWindowLook()
const Page =
  page === 'settings'
    ? Settings
    : page === 'update'
      ? Update
      : page === 'computers'
        ? Computers
        : App

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
)
