// 시스템 서버 relay(docs/relay.md)에 붙어 있는 동작 한 벌. 컴퓨터판과 휴대폰판이 같이 쓴다.
// 다른 꾸러미를 불러오지 않는다. 소켓을 만드는 법과 계정은 앱이 넘겨 준다: 휴대폰 소켓은 머리글을 세 번째 값으로 받고
// 컴퓨터판 소켓은 두 번째 값으로 받으며, 토큰을 보관하는 곳도 서로 다르기 때문이다.

export type RelayRole = 'host' | 'viewer'
export type RelayPeer = { deviceId: string; name: string; role: string }
/** signedOut: 로그인 없음. offline: 끊겨서 다시 붙을 차례. stopped: 다시 붙으면 안 되는 이유로 멈춤(stopReason). */
export type RelayStatus = 'signedOut' | 'connecting' | 'connected' | 'offline' | 'stopped'
/** otherApp: 다른 앱의 토큰(4403). tookOver: 같은 기기의 새 연결이 자리를 가져감(4409). */
export type RelayStopReason = 'otherApp' | 'tookOver'

/** ok · rejected · network · signedOut 넷을 가른다. rejected 일 때만 로그인이 끝난 것이고, network 는 다시 해 본다. */
export type RelayRefreshResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'rejected' | 'network' | 'signedOut' }

export type RelayAccount = {
  accessToken: () => string | null | Promise<string | null>
  refresh: () => Promise<RelayRefreshResult>
  /** 로그인한 사람(이메일 등). 바뀌면 토큰만 넘기지 않고 연결을 새로 연다. */
  owner?: () => string | null
  /** 토큰이 바뀌면 부른다. 없으면 만료 확인 때 알아챈다. */
  onChange?: (listener: () => void) => () => void
}

export type RelayMessage = {
  type?: string
  from?: string
  fromRole?: string
  to?: string
  id?: string
  name?: string
  args?: Record<string, unknown>
  ok?: boolean
  data?: unknown
  deviceId?: string
  peers?: RelayPeer[]
  peer?: RelayPeer
  [key: string]: unknown
}

/** 표준 WebSocket 에서 relay 가 쓰는 부분만. Node · 브라우저 · React Native 소켓이 모두 맞는다. */
export type RelaySocket = {
  readyState: number
  send: (text: string) => void
  close: () => void
  onopen: ((event: never) => unknown) | null
  onmessage: ((event: never) => unknown) | null
  onclose: ((event: never) => unknown) | null
  onerror: ((event: never) => unknown) | null
}

export type RelayCommand = (
  args: Record<string, unknown>,
  message: RelayMessage
) => Promise<unknown>

export type RelayOptions = {
  url: string
  projectName: string
  role: RelayRole
  account: RelayAccount
  deviceId: () => string | Promise<string>
  name: () => string | Promise<string>
  /** 머리글로 토큰을 붙인 소켓을 만든다. 주소에 넣으면 서버 기록에 남으므로 머리글로 보낸다. */
  createSocket: (url: string, token: string) => RelaySocket
  commands?: Record<string, RelayCommand>
  /** 이 명령을 받아도 되는가. 기본은 휴대폰(viewer)이 보낸 것만 받는다. */
  allow?: (message: RelayMessage) => boolean
  /** host 가 보낼 state. 없으면(null) 보내지 않는다. */
  state?: () => unknown
  stateEveryMs?: number
  /** 실행해도 state 를 바로 다시 보내지 않을 명령(읽기만 하는 명령). */
  quietCommands?: string[]
  /** relay 가 처리한 뒤의 모든 메시지. state · signal 처럼 앱이 쓰는 것을 여기서 받는다. */
  onMessage?: (message: RelayMessage) => void
}

export type Relay = {
  start: () => void
  stop: () => void
  status: () => RelayStatus
  stopReason: () => RelayStopReason | null
  /** 연결이 마지막으로 끊긴 때. 다시 붙으면 null. */
  lostAt: () => number | null
  onStatus: (listener: (status: RelayStatus) => void) => () => void
  peers: (role?: string) => RelayPeer[]
  onPeers: (listener: (peers: RelayPeer[]) => void) => () => void
  ask: (
    to: string,
    name: string,
    args?: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<unknown>
  send: (message: unknown) => boolean
  /** 휴대폰으로 푸시를 보낸다. 끊겨 있으면 30분까지 기다렸다 보낸다. */
  alert: (title: string, body: string) => void
  /** 멈춘 뒤 사용자가 누른 「다시 연결」. */
  reconnect: () => void
  /** 앱이 다시 앞으로 왔을 때. 뒤에 있는 동안 소켓이 말없이 죽었을 수 있다. */
  wake: () => void
}

const OPEN = 1
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 60_000
const STATE_MS = 5000
const ASK_TIMEOUT_MS = 60_000
const CLOSE_UNAUTHORIZED = 4401
const CLOSE_WRONG_APP = 4403
const CLOSE_REPLACED = 4409
// 토큰은 1시간짜리이고 서버는 끝난 토큰의 연결을 4401 로 끊는다. 그래서 조금 앞서 갱신해 열린 연결에 넘긴다.
const RENEW_BEFORE_MS = 5 * 60_000
// 다른 곳에서 갱신한 토큰도 넘기려고 적어도 이만큼마다 본다.
const CHECK_MAX_MS = 5 * 60_000
const CHECK_MIN_MS = 30_000
const RENEW_RETRY_MS = 60_000
const TOKEN_HOUR_MS = 60 * 60_000
const ALERT_KEEP_MS = 30 * 60_000
// host 는 5초마다 보내므로 이만큼 아무 말이 없으면 소켓이 죽은 것으로 본다.
const SILENT_MS = 30_000

/** 토큰이 끝나는 때(밀리초). 읽을 수 없으면 null. */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const exp = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

export function createRelay(options: RelayOptions): Relay {
  const { account } = options
  let running = false
  let socket: RelaySocket | null = null
  let status: RelayStatus = 'signedOut'
  let stopReason: RelayStopReason | null = null
  let lostAt: number | null = null
  let wasConnected = false
  let retryMs = RETRY_MIN_MS
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let renewTimer: ReturnType<typeof setTimeout> | null = null
  let beat: ReturnType<typeof setInterval> | null = null
  let refreshedOnce = false
  // 연결을 새로 열 때마다 올린다. 기다리는 사이 다른 연결이 시작됐으면 옛 흐름을 버린다.
  let attempt = 0
  let sentToken: string | null = null
  let tokenSeenAt = 0
  let connectedOwner: string | null = null
  let heardAt = 0
  let asked = 0
  let stopWatching: (() => void) | null = null
  let pendingAlerts: { title: string; body: string; at: number }[] = []
  const peers = new Map<string, RelayPeer>()
  const waiting = new Map<
    string,
    {
      to: string
      resolve: (data: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const statusListeners = new Set<(status: RelayStatus) => void>()
  const peerListeners = new Set<(peers: RelayPeer[]) => void>()

  const setStatus = (next: RelayStatus) => {
    if (next === status) {
      return
    }
    status = next
    for (const listener of statusListeners) {
      listener(next)
    }
  }

  const listPeers = (role?: string) =>
    [...peers.values()].filter((peer) => !role || peer.role === role)

  const peersChanged = () => {
    const list = listPeers()
    for (const listener of peerListeners) {
      listener(list)
    }
  }

  const send = (message: unknown) => {
    if (socket?.readyState !== OPEN) {
      return false
    }
    socket.send(JSON.stringify(message))
    return true
  }

  const clearTimer = (which: 'retry' | 'renew') => {
    if (which === 'retry' && retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (which === 'renew' && renewTimer) {
      clearTimeout(renewTimer)
      renewTimer = null
    }
  }

  const forgetConnection = () => {
    if (beat) {
      clearInterval(beat)
      beat = null
    }
    clearTimer('renew')
    if (wasConnected) {
      lostAt ??= Date.now()
    }
    wasConnected = false
    if (peers.size > 0) {
      peers.clear()
      peersChanged()
    }
    for (const [id, wait] of waiting) {
      clearTimeout(wait.timer)
      wait.reject(new Error('offline'))
      waiting.delete(id)
    }
  }

  /** 끊겼다는 알림을 기다리지 않고 지금 연결을 버린다. */
  const dropSocket = () => {
    const old = socket
    socket = null
    forgetConnection()
    if (old) {
      old.onopen = null
      old.onmessage = null
      old.onclose = null
      old.onerror = null
      old.close()
    }
  }

  const schedule = (ms: number) => {
    clearTimer('retry')
    retryTimer = setTimeout(() => {
      retryTimer = null
      void connect()
    }, ms)
  }

  const retryLater = () => {
    schedule(retryMs)
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2)
  }

  const sendState = () => {
    const data = options.state?.()
    if (data) {
      send({ type: 'state', data })
    }
  }

  const sendPendingAlerts = () => {
    const now = Date.now()
    for (const alert of pendingAlerts) {
      if (now - alert.at < ALERT_KEEP_MS) {
        send({ type: 'alert', title: alert.title, body: alert.body })
      }
    }
    pendingAlerts = []
  }

  const signedOut = () => {
    dropSocket()
    clearTimer('retry')
    setStatus('signedOut')
  }

  const keepFresh = async () => {
    renewTimer = null
    const mine = attempt
    let token = await account.accessToken()
    if (!running || mine !== attempt || !token) {
      return
    }
    // 다른 곳에서 갱신한 토큰은 그때부터 새 1시간이다.
    if (token !== sentToken) {
      tokenSeenAt = Date.now()
    }
    // 끝나는 때를 읽을 수 없는 토큰은 처음 본 때부터 1시간으로 잡는다.
    if ((tokenExpiry(token) ?? tokenSeenAt + TOKEN_HOUR_MS) - Date.now() < RENEW_BEFORE_MS) {
      const result = await account.refresh()
      if (!running || mine !== attempt) {
        return
      }
      if (!result.ok) {
        if (result.reason === 'network') {
          renewTimer = setTimeout(() => void keepFresh(), RENEW_RETRY_MS)
        } else {
          signedOut()
        }
        return
      }
      token = result.token
      tokenSeenAt = Date.now()
    }
    if (token !== sentToken && send({ type: 'auth', token })) {
      sentToken = token
    }
    const next = (tokenExpiry(token) ?? tokenSeenAt + TOKEN_HOUR_MS) - RENEW_BEFORE_MS - Date.now()
    renewTimer = setTimeout(
      () => void keepFresh(),
      Math.min(CHECK_MAX_MS, Math.max(CHECK_MIN_MS, next))
    )
  }

  const handleCommand = (message: RelayMessage) => {
    const reply = (ok: boolean, data: unknown) =>
      send({ type: 'result', to: message.from, id: message.id, ok, data })
    const allowed = options.allow ? options.allow(message) : message.fromRole === 'viewer'
    if (!allowed) {
      reply(false, { error: 'not allowed' })
      return
    }
    const handler = message.name ? options.commands?.[message.name] : undefined
    if (!handler) {
      reply(false, { error: 'unknown command' })
      return
    }
    handler(message.args ?? {}, message)
      .then((data) => {
        reply(true, data ?? null)
        // 명령이 바꾼 것(앱을 껐다, 폴더를 비웠다)이 휴대폰에 바로 보이게 한다.
        if (!options.quietCommands?.includes(message.name ?? '')) {
          sendState()
        }
      })
      .catch((error: unknown) =>
        reply(false, { error: error instanceof Error ? error.message : String(error) })
      )
  }

  const handleMessage = (message: RelayMessage) => {
    if (message.type === 'peers') {
      peers.clear()
      for (const peer of message.peers ?? []) {
        peers.set(peer.deviceId, peer)
      }
      peersChanged()
      // 서버는 소켓을 먼저 받고 토큰은 그 뒤에 본다. 그래서 peers 를 받은 뒤에야 성공으로 친다.
      // 받자마자 끊는 서버에 쉬지 않고 다시 붙지 않게 하려는 것이다.
      retryMs = RETRY_MIN_MS
      refreshedOnce = false
      wasConnected = true
      lostAt = null
      stopReason = null
      setStatus('connected')
      sendPendingAlerts()
      clearTimer('renew')
      void keepFresh()
    } else if (message.type === 'peer-joined' && message.peer) {
      peers.set(message.peer.deviceId, message.peer)
      peersChanged()
    } else if (message.type === 'peer-left' && message.deviceId) {
      if (peers.delete(message.deviceId)) {
        peersChanged()
      }
    } else if (message.type === 'result' && message.id) {
      const wait = waiting.get(message.id)
      // 물어본 기기의 답만 받는다. 서버가 from 을 채우므로 앱이 속일 수 없다.
      if (wait && (!message.from || message.from === wait.to)) {
        waiting.delete(message.id)
        clearTimeout(wait.timer)
        if (message.ok) {
          wait.resolve(message.data)
        } else {
          const error = (message.data as { error?: unknown } | undefined)?.error
          wait.reject(new Error(String(error ?? 'failed')))
        }
      }
    } else if (message.type === 'command' && message.id) {
      handleCommand(message)
    }
    options.onMessage?.(message)
  }

  const handleClose = async (code: number, mine: number) => {
    forgetConnection()
    socket = null
    if (!running) {
      return
    }
    if (code === CLOSE_WRONG_APP || code === CLOSE_REPLACED) {
      // 다시 붙으면 두 연결이 서로 끊기를 되풀이한다.
      stopReason = code === CLOSE_WRONG_APP ? 'otherApp' : 'tookOver'
      setStatus('stopped')
      return
    }
    setStatus('offline')
    if (code !== CLOSE_UNAUTHORIZED || refreshedOnce) {
      retryLater()
      return
    }
    refreshedOnce = true
    const result = await account.refresh()
    if (!running || mine !== attempt) {
      return
    }
    if (result.ok) {
      schedule(0)
    } else if (result.reason === 'network') {
      // 인터넷이 없는 것은 로그아웃이 아니다. 다음 4401 에도 다시 갱신하게 표시를 되돌린다.
      refreshedOnce = false
      retryLater()
    } else {
      setStatus('signedOut')
    }
  }

  const connect = async () => {
    const mine = ++attempt
    const token = await account.accessToken()
    if (!running || mine !== attempt) {
      return
    }
    if (!token) {
      setStatus('signedOut')
      return
    }
    setStatus('connecting')
    sentToken = token
    tokenSeenAt = Date.now()
    connectedOwner = account.owner?.() ?? null
    const ws = options.createSocket(options.url, token)
    socket = ws
    ws.onopen = () => {
      void (async () => {
        const [deviceId, name] = await Promise.all([options.deviceId(), options.name()])
        if (socket !== ws) {
          return
        }
        send({
          type: 'hello',
          deviceId,
          projectName: options.projectName,
          name,
          role: options.role
        })
        if (options.state) {
          sendState()
          beat = setInterval(sendState, options.stateEveryMs ?? STATE_MS)
        }
      })().catch(() => ws.close())
    }
    ws.onmessage = (event: { data: unknown }) => {
      if (socket !== ws) {
        return
      }
      let message: RelayMessage
      try {
        message = JSON.parse(String(event.data)) as RelayMessage
      } catch {
        return
      }
      heardAt = Date.now()
      handleMessage(message)
    }
    ws.onclose = (event: { code: number }) => {
      if (socket === ws) {
        void handleClose(event.code, mine)
      }
    }
    // 오류 뒤에는 항상 close 가 오고, 거기서 다시 붙는다.
    ws.onerror = () => undefined
  }

  const accountChanged = async () => {
    if (!running) {
      return
    }
    const token = await account.accessToken()
    if (!running) {
      return
    }
    const sameOwner = (account.owner?.() ?? null) === connectedOwner
    if (token && sameOwner && socket?.readyState === OPEN) {
      if (token !== sentToken && send({ type: 'auth', token })) {
        sentToken = token
        tokenSeenAt = Date.now()
      }
      clearTimer('renew')
      void keepFresh()
      return
    }
    // 같은 계정의 토큰 갱신이 「다른 곳에서 쓰는 중」으로 멈춘 상태를 풀면 안 된다.
    if (token && sameOwner && status === 'stopped') {
      return
    }
    dropSocket()
    stopReason = null
    retryMs = RETRY_MIN_MS
    refreshedOnce = false
    schedule(0)
  }

  return {
    start() {
      if (running) {
        return
      }
      running = true
      stopWatching = account.onChange?.(() => void accountChanged()) ?? null
      void connect()
    },
    stop() {
      running = false
      attempt += 1
      stopWatching?.()
      stopWatching = null
      clearTimer('retry')
      dropSocket()
      setStatus('signedOut')
    },
    status: () => status,
    stopReason: () => stopReason,
    lostAt: () => lostAt,
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    peers: listPeers,
    onPeers(listener) {
      peerListeners.add(listener)
      return () => peerListeners.delete(listener)
    },
    ask(to, name, args = {}, timeoutMs = ASK_TIMEOUT_MS) {
      if (status !== 'connected') {
        return Promise.reject(new Error('offline'))
      }
      asked += 1
      const id = `ask-${asked}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error('timeout'))
        }, timeoutMs)
        waiting.set(id, { to, resolve, reject, timer })
        send({ type: 'command', to, id, name, args })
      })
    },
    send,
    alert(title, body) {
      if (status === 'connected' && send({ type: 'alert', title, body })) {
        return
      }
      pendingAlerts = [
        ...pendingAlerts.filter((alert) => alert.title !== title),
        { title, body, at: Date.now() }
      ]
    },
    reconnect() {
      if (!running) {
        return
      }
      dropSocket()
      stopReason = null
      retryMs = RETRY_MIN_MS
      refreshedOnce = false
      schedule(0)
    },
    wake() {
      if (!running || status === 'stopped' || status === 'signedOut') {
        return
      }
      if (socket?.readyState === OPEN && Date.now() - heardAt < SILENT_MS) {
        return
      }
      dropSocket()
      retryMs = RETRY_MIN_MS
      schedule(0)
    }
  }
}
