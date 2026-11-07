// 이 컴퓨터가 로그인한 RUNNERS 계정. 계정의 다른 컴퓨터와 휴대폰 앱은 시스템 서버 relay 로 이 컴퓨터에 닿고,
// relay 는 같은 계정으로 로그인한 기기만 잇는다. 토큰 보관과 로그인은 kit 부품이 한다.
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { createAccount, type Account } from './runners/account'

/** 개발 실행은 시험 서버를 쓸 수 있다(`MONITOR_API_URL=http://127.0.0.1:8787`). */
const API_URL =
  (!app.isPackaged && process.env.MONITOR_API_URL) || 'https://server.system.runners.im'

let made: Account | null = null

// Why: 개발 실행은 index.ts 가 userData 를 바꾸는데, 그 줄은 이 파일을 불러온 다음에 돈다.
function account(): Account {
  made ??= createAccount({
    project: 'MONITOR',
    filePath: join(app.getPath('userData'), 'account.bin'),
    apiUrl: API_URL,
    safeStorage
  })
  return made
}

export const current = () => account().current()
export const onChange = (listener: () => void) => account().onChange(listener)
export const accessToken = () => account().accessToken()
export const refresh = () => account().refresh()
export const signIn = (mode: 'login' | 'signup', email: string, password: string) =>
  account().signIn(mode, email, password)
export const signOut = () => account().signOut()
