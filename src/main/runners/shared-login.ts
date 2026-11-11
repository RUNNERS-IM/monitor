// 같은 Mac 의 RUNNERS 앱들이 함께 쓰는 로그인 칸. 한 앱에서 로그인하면 나머지 앱은 이 칸의 토큰을 보여 주고 자기 토큰을 받는다.
// 칸은 키체인에 있고 runners-shared-login 프로그램만 읽는다(shared-login-helper/main.swift). 키체인을 못 쓰면 앱마다 로그인하던 예전과 같다.
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

const HELPER_TIMEOUT_MS = 5_000

/** 함께 로그인하는 앱. 서버 projects 표의 이름과 화면에 보일 이름. 앱을 넣고 뺄 때는 이 목록과 서버 허용 목록만 고친다. */
export const SHARED_LOGIN_APPS: Record<string, string> = {
  REMOTE: 'Remote',
  MONITOR: 'Monitor',
  PROMPT: 'Prompt',
  SPLIT: 'Split'
}

export type SharedLogin = {
  /** 로그인 · 로그아웃마다 하나 늘어난다. 꺼져 있던 앱이 「로그아웃됨」과 「처음부터 없음」을 구별하는 데 쓴다. */
  generation: number
  /** 칸의 토큰이 지금 쓸 수 있으면 그 내용. 로그아웃했으면 null. */
  signedIn: { email: string; project: string; refreshToken: string } | null
}

export type SharedLoginStore = {
  /** 칸이 없으면 null. 읽지 못하면 던진다. */
  read: () => Promise<SharedLogin | null>
  /** 칸의 번호가 더 크면 쓰지 않는다. 그사이 다른 앱이 한 로그아웃을 덮지 않기 위해서다. */
  write: (next: SharedLogin) => Promise<void>
  /** 다른 앱이 로그인하거나 로그아웃하면 부른다. */
  watch: (listener: () => void) => () => void
}

export type KeychainSharedLoginOptions = {
  /** 앱 안에 들어 있는 runners-shared-login 프로그램 경로 */
  helperPath: string
  /** 칸이 바뀌었다고 알리는 파일. 번호만 적혀 있고 토큰은 없다. 네 앱이 같은 경로를 쓴다. */
  signalPath: string
}

export function createKeychainSharedLogin(options: KeychainSharedLoginOptions): SharedLoginStore {
  const { helperPath, signalPath } = options
  let lastGeneration = -1

  return {
    read: () =>
      new Promise((resolve, reject) => {
        execFile(helperPath, ['read'], { timeout: HELPER_TIMEOUT_MS }, (error, stdout) => {
          if (error) {
            reject(error)
            return
          }
          try {
            const slot = stdout ? (JSON.parse(stdout) as SharedLogin) : null
            lastGeneration = slot?.generation ?? lastGeneration
            resolve(slot)
          } catch (problem) {
            reject(problem)
          }
        })
      }),
    write: (next) =>
      new Promise((resolve, reject) => {
        // 토큰이 프로세스 목록에 보이지 않게 인자가 아니라 표준 입력으로 넘긴다.
        const child = spawn(helperPath, ['write'], {
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: HELPER_TIMEOUT_MS
        })
        child.on('error', reject)
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`shared login helper ${code}`))
            return
          }
          if (next.generation !== lastGeneration) {
            lastGeneration = next.generation
            mkdirSync(dirname(signalPath), { recursive: true })
            writeFileSync(signalPath, String(next.generation), { mode: 0o600 })
          }
          resolve()
        })
        child.stdin.end(JSON.stringify(next))
      }),
    watch(listener) {
      mkdirSync(dirname(signalPath), { recursive: true })
      const watcher = watch(dirname(signalPath), (_event, name) => {
        if (name !== basename(signalPath)) {
          return
        }
        let said = ''
        try {
          said = readFileSync(signalPath, 'utf8')
        } catch {
          return
        }
        // 자기가 쓴 알림은 다시 읽지 않는다.
        if (said !== String(lastGeneration)) {
          listener()
        }
      })
      return () => watcher.close()
    }
  }
}
