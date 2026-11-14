// 오류 자동 수집을 다른 모듈보다 먼저 켠다. Why: index.ts 의 import 들이 읽히는 동안 난 오류도 잡고, 화면이 오류를
// 넘기는 통로(@sentry/electron 의 프로토콜)는 app 준비 전에 등록해야 한다. 그래서 index.ts 의 첫 import 로 둔다.
// DSN 이 비면(개발 실행 · 시크릿을 넣기 전 빌드) 아무것도 하지 않는다.
import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'
import { hostname, userInfo } from 'node:os'
import { startErrorReport } from './runners/error-report'

startErrorReport(Sentry, {
  dsn: import.meta.env.MAIN_VITE_SENTRY_DSN,
  release: `monitor@${app.getVersion()}`,
  environment: app.isPackaged ? 'production' : 'development',
  hide: [hostname(), userInfo().username]
})
