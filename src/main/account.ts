// The RUNNERS account this computer is signed in with. Why: the account's other computers and the phone app reach this
// computer through the system server's relay (shared decisions 2026-11-03 "네 앱 컴퓨터판 · 휴대폰판 개발 방식" and
// 2026-11-05 "네 앱 계정 · 연결 통일"), and the relay only joins devices that sign in with the same account. Same calls as runners-app-kit (src/auth, src/api/request.ts).
import { app, safeStorage } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Debug runs can point at a local test server (`MONITOR_API_URL=http://127.0.0.1:8787`). */
export const API_URL =
  (!app.isPackaged && process.env.MONITOR_API_URL) || 'https://server.system.runners.im'
const PROJECT = 'MONITOR'
const FILE = 'account.bin'

type Tokens = { accessToken: string; refreshToken: string }
type Saved = { email: string; tokens: Tokens }

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`API ${status}`)
  }
}

let saved: Saved | null | undefined
const listeners = new Set<() => void>()

function file(): string {
  return join(app.getPath('userData'), FILE)
}

/** Why: the tokens sign in as the person, so they are kept encrypted with the OS keychain where there is one. */
function load(): Saved | null {
  if (saved !== undefined) {
    return saved
  }
  try {
    const bytes = readFileSync(file())
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(bytes)
      : bytes.toString('utf8')
    saved = JSON.parse(text) as Saved
  } catch {
    saved = null
  }
  return saved
}

function store(next: Saved | null): void {
  saved = next
  if (next) {
    const text = JSON.stringify(next)
    writeFileSync(
      file(),
      safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text,
      { mode: 0o600 }
    )
  } else {
    rmSync(file(), { force: true })
  }
  for (const listener of listeners) {
    listener()
  }
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  const parsed = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    throw new ApiError(res.status, parsed)
  }
  // Why: system-server wraps successful answers as {code, data}.
  const wrapped = parsed as { code?: unknown; data?: unknown } | null
  return (
    wrapped && typeof wrapped === 'object' && 'code' in wrapped && 'data' in wrapped
      ? wrapped.data
      : parsed
  ) as T
}

/** The signed-in email, or null. */
export function current(): string | null {
  return load()?.email ?? null
}

export function onChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Signs in, or makes the account first. Throws an Error "bad" (wrong email or password), "exists" (the email already
 *  has an account) or anything else (the server could not be reached), as the shared sign-in sheet expects. */
export async function signIn(
  mode: 'login' | 'signup',
  email: string,
  password: string
): Promise<void> {
  try {
    // Why: the server checks the password as typed (6 to 20 letters and digits); it does the hashing itself.
    const res = await post<{ user: { email: string }; tokens: Tokens }>(
      `/api/mobile/auth/${mode}`,
      { email, password, projectName: PROJECT }
    )
    store({ email: res.user?.email ?? email, tokens: res.tokens })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new Error('exists')
    }
    if (error instanceof ApiError && [400, 401, 404].includes(error.status)) {
      throw new Error('bad')
    }
    throw error
  }
}

export async function signOut(): Promise<void> {
  const was = load()
  store(null)
  if (was) {
    await post('/api/mobile/auth/logout', { refreshToken: was.tokens.refreshToken }).catch(
      () => undefined
    )
  }
}

export function accessToken(): string | null {
  return load()?.tokens.accessToken ?? null
}

/** Why: same outcomes as runners-app-kit refreshSession(). Only "rejected" ends the sign-in; "network" means the
 * server could not be reached or was briefly unwell, so the tokens stay and the caller tries again later. */
export type RefreshResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'rejected' | 'network' | 'signedOut' }

let refreshing: Promise<RefreshResult> | null = null

/** Gets a new access token; signs out only when the server refuses the refresh token (401). */
export function refresh(): Promise<RefreshResult> {
  refreshing ??= (async (): Promise<RefreshResult> => {
    const was = load()
    if (!was) {
      return { ok: false, reason: 'signedOut' }
    }
    try {
      const tokens = await post<Tokens>('/api/mobile/auth/refresh', {
        refreshToken: was.tokens.refreshToken
      })
      store({ ...was, tokens })
      return { ok: true, token: tokens.accessToken }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
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

/** When the access token runs out, in milliseconds since 1970, or null when it cannot be read. */
export function accessTokenExpiry(): number | null {
  const token = accessToken()
  try {
    const exp = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString('utf8')).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}
