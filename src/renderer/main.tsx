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
  page === 'settings' ? Settings : page === 'update' ? Update : page === 'computers' ? Computers : App

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
)
