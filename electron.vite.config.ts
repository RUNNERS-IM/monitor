import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 메인(src/main) · preload(src/preload) · 화면(src/renderer). 화면 한 장이 주소(#panel, #about …)로 창마다 다른 그림을 낸다.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Why: debug runs read VITE_MONITOR_EXPAND to start with a row open.
    envPrefix: ['VITE_'],
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
