// 이 컴퓨터가 로그인한 RUNNERS 계정. 토큰을 보관하고 시스템 서버 /api/mobile/auth/* 를 부른다.
// Electron 을 직접 불러오지 않고 safeStorage 와 파일 위치를 받는다. 그래서 앱마다 그대로 복사해 쓰고 Electron 없이 시험한다.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const TIMEOUT_MS = 15_000

export type AccountTokens = { accessToken: string; refreshToken: string }
type Saved = { email: string; tokens: AccountTokens }

export type AccountSafeStorage = {
  isEncryptionAvailable: () => boolean
  encryptString: (text: string) => Buffer
  decryptString: (bytes: Buffer) => string
}

export type AccountOptions = {
  /** 시스템 서버 projects 표의 이름: SPLIT · MONITOR · REMOTE · PROMPT */
  project: string
  /** 토큰을 둘 파일. 보통 userData 안의 account.bin */
  filePath: string
  apiUrl: string
  safeStorage: AccountSafeStorage
  /** 시험할 때 바꿔 끼운다. */
  fetch?: typeof fetch
}

export type AccountRefreshResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'rejected' | 'network' | 'signedOut' }

export class AccountApiError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`API ${status}`)
  }
}

type SignedIn = { user?: { email?: string }; tokens: AccountTokens }

/** 서버 답을 공통 로그인 창이 읽는 코드로 바꾼다(runners-account.tsx 의 SignInProblem).
 *  404 · 'User not found' 계정 없음, 401 비밀번호 틀림, 400 비밀번호 모양, 409 이미 있는 계정, 422 틀린 숫자,
 *  429 너무 잦음. 그 밖은 그대로 던져 창이 「서버에 연결할 수 없음」으로 보인다. */
export function accountProblem(error: unknown): unknown {
  if (!(error instanceof AccountApiError)) {
    return error
  }
  const said = JSON.stringify(error.body ?? '')
  const code =
    error.status === 404 || (error.status === 401 && said.includes('User not found'))
      ? 'none'
      : (
          {
            400: 'format',
            401: 'bad',
            409: 'exists',
            422: 'code',
            429: 'many'
          } as Record<number, string>
        )[error.status]
  return code ? new Error(code, { cause: error }) : error
}

const problem = (error: unknown): never => {
  throw accountProblem(error)
}

export type Account = ReturnType<typeof createAccount>

export function createAccount(options: AccountOptions) {
  const { filePath, apiUrl, project, safeStorage } = options
  const request = options.fetch ?? fetch
  let saved: Saved | null | undefined
  let refreshing: Promise<AccountRefreshResult> | null = null
  const listeners = new Set<() => void>()

  // 토큰은 이 사람으로 로그인하는 열쇠라, 운영체제 키체인을 쓸 수 있으면 암호화해 둔다.
  const load = (): Saved | null => {
    if (saved !== undefined) {
      return saved
    }
    try {
      const bytes = readFileSync(filePath)
      const text = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(bytes)
        : bytes.toString('utf8')
      saved = JSON.parse(text) as Saved
    } catch {
      saved = null
    }
    return saved
  }

  const store = (next: Saved | null) => {
    saved = next
    if (next) {
      const text = JSON.stringify(next)
      const bytes = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text
      mkdirSync(dirname(filePath), { recursive: true })
      // 쓰다가 앱이 꺼져도 앞 로그인이 살아 있게 임시 파일을 먼저 쓰고 바꾼다.
      const temp = `${filePath}.tmp`
      writeFileSync(temp, bytes, { mode: 0o600 })
      renameSync(temp, filePath)
    } else {
      rmSync(filePath, { force: true })
    }
    for (const listener of listeners) {
      listener()
    }
  }

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await request(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      // 앞단(ALB)이 JSON 이 아닌 오류 화면을 줄 때가 있다. 그때도 상태 번호로 판단한다.
    }
    if (!res.ok) {
      throw new AccountApiError(res.status, parsed)
    }
    // 시스템 서버는 성공 답을 { code, data } 로 감싼다.
    const wrapped = parsed as { code?: unknown; data?: unknown } | null
    const isWrapped =
      wrapped !== null && typeof wrapped === 'object' && 'code' in wrapped && 'data' in wrapped
    return (isWrapped ? wrapped.data : parsed) as T
  }

  return {
    /** 로그인한 이메일. 없으면 null. */
    current: () => load()?.email ?? null,
    onChange(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** 로그인하거나 계정을 만든다. 실패하면 공통 로그인 창이 읽는 코드(SignInProblem)를 메시지로 던진다.
     *  code 는 가입할 때 메일로 받은 숫자다. */
    async signIn(mode: 'login' | 'signup', email: string, password: string, code?: string) {
      const typed = email.trim()
      // 서버는 비밀번호를 입력한 그대로 받아(영문 + 숫자 6~20자) 직접 해시한다.
      const res = await post<SignedIn>(`/api/mobile/auth/${mode}`, {
        email: typed,
        password,
        projectName: project,
        ...(code ? { code } : {})
      }).catch(problem)
      store({ email: res.user?.email ?? typed, tokens: res.tokens })
    },
    /** 메일로 6자리 숫자를 보낸다. signup 은 가입용(이미 계정이 있으면 exists), reset 은 비밀번호 찾기용(없으면 none). */
    async sendCode(purpose: 'signup' | 'reset', email: string, locale?: string) {
      await post(
        purpose === 'signup' ? '/api/mobile/auth/email-code' : '/api/mobile/auth/password-reset',
        {
          email: email.trim(),
          projectName: project,
          locale
        }
      ).catch(problem)
    },
    /** 메일로 받은 숫자로 새 비밀번호를 정하고 그대로 로그인한다. 네 앱이 한 비밀번호라 넷 다 바뀐다. */
    async resetPassword(email: string, code: string, password: string) {
      const typed = email.trim()
      const res = await post<SignedIn>('/api/mobile/auth/password-reset/confirm', {
        email: typed,
        code,
        password,
        projectName: project
      }).catch(problem)
      store({ email: res.user?.email ?? typed, tokens: res.tokens })
    },
    async signOut() {
      const was = load()
      store(null)
      if (was) {
        await post('/api/mobile/auth/logout', {
          refreshToken: was.tokens.refreshToken
        }).catch(() => undefined)
      }
    },
    accessToken: () => load()?.tokens.accessToken ?? null,
    /** 새 액세스 토큰을 받는다. 서버가 리프레시 토큰을 거절(401)했을 때만 로그아웃한다.
     *  network 는 서버에 닿지 못했거나 잠깐 아픈 것이라 토큰을 그대로 둔다. 동시에 불러도 한 번만 간다. */
    refresh(): Promise<AccountRefreshResult> {
      refreshing ??= (async (): Promise<AccountRefreshResult> => {
        const was = load()
        if (!was) {
          return { ok: false, reason: 'signedOut' }
        }
        try {
          const tokens = await post<AccountTokens>('/api/mobile/auth/refresh', {
            refreshToken: was.tokens.refreshToken
          })
          store({ ...was, tokens })
          return { ok: true, token: tokens.accessToken }
        } catch (error) {
          if (error instanceof AccountApiError && error.status === 401) {
            store(null)
            return { ok: false, reason: 'rejected' }
          }
          return { ok: false, reason: 'network' }
        }
      })().finally(() => {
        refreshing = null
      })
      return refreshing
    }
  }
}
