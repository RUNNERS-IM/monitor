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
  /**
   * 설치한 판인가(app.isPackaged). 거짓이면 키체인을 쓰지 않는다. 서명이 다른 개발 실행이 키체인 허락 창을 띄우지 않게 한다.
   * 없으면 설치한 판으로 친다.
   */
  isPackaged?: boolean
  /** 서버가 어느 앱의 요청인지 알아보게 보내는 이름. 예: Monitor/2.6.110701. 없으면 Node 기본값 node 가 나간다. */
  userAgent?: string
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

  // 토큰은 이 사람으로 로그인하는 열쇠라 키체인으로 암호화해서만 파일에 둔다. 개인정보 처리방침의
  // 「토큰은 시스템 키체인으로 암호화합니다」와 맞춘다. 암호화할 수 없으면(키링 없는 Linux, 개발 실행) 메모리에만 두고,
  // 다시 켜면 로그인 화면이 뜬다.
  const canEncrypt = () => options.isPackaged !== false && safeStorage.isEncryptionAvailable()

  const plainSaved = (bytes: Buffer): Saved | null => {
    try {
      return JSON.parse(bytes.toString('utf8')) as Saved
    } catch {
      return null
    }
  }

  const write = (next: Saved) => {
    mkdirSync(dirname(filePath), { recursive: true })
    // 쓰다가 앱이 꺼져도 앞 로그인이 살아 있게 임시 파일을 먼저 쓰고 바꾼다.
    const temp = `${filePath}.tmp`
    writeFileSync(temp, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 })
    renameSync(temp, filePath)
  }

  const load = (): Saved | null => {
    if (saved !== undefined) {
      return saved
    }
    saved = null
    let bytes: Buffer
    try {
      bytes = readFileSync(filePath)
    } catch {
      return saved
    }
    // 옛 판은 암호화할 수 없을 때 평문으로 썼다. 평문 토큰은 남기지 않는다.
    const plain = plainSaved(bytes)
    if (!canEncrypt()) {
      if (plain) {
        rmSync(filePath, { force: true })
      }
      return saved
    }
    if (plain) {
      saved = plain
      write(plain)
      return saved
    }
    try {
      saved = JSON.parse(safeStorage.decryptString(bytes)) as Saved
    } catch {
      saved = null
    }
    return saved
  }

  const store = (next: Saved | null) => {
    saved = next
    if (next && canEncrypt()) {
      write(next)
    } else {
      // 메모리에만 둘 때도 앞 로그인 파일은 지운다. 남기면 키체인이 돌아왔을 때 앞 계정이 살아난다.
      rmSync(filePath, { force: true })
    }
    for (const listener of listeners) {
      listener()
    }
  }

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await request(`${apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.userAgent ? { 'User-Agent': options.userAgent } : {})
      },
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

  // 갱신 답을 기다리는 사이 로그아웃했거나 다른 계정으로 들어왔으면 그 답은 앞 로그인의 것이다. 저장하면 앞 로그인이 되살아나므로
  // 버리고, 지금 상태를 알린다.
  const afterAccountChange = (): AccountRefreshResult => {
    const now = load()
    return now ? { ok: true, token: now.tokens.accessToken } : { ok: false, reason: 'signedOut' }
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
          if (load() !== was) {
            // 아무도 쓰지 않을 새 토큰이라 서버에서도 끝낸다.
            void post('/api/mobile/auth/logout', { refreshToken: tokens.refreshToken }).catch(
              () => undefined
            )
            return afterAccountChange()
          }
          store({ ...was, tokens })
          return { ok: true, token: tokens.accessToken }
        } catch (error) {
          if (load() !== was) {
            return afterAccountChange()
          }
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
