// 이 컴퓨터를 시스템 서버 relay 에 올려 둔다. 휴대폰 앱이 이 컴퓨터를 보고 명령하고, 계정의 다른 컴퓨터가 숫자를 읽는다.
// 연결 동작은 kit 부품(relay-core)이 하고, 여기에는 Monitor 만의 규칙만 둔다.
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import * as account from './account'
import { createRelay, type Relay, type RelayCommand, type RelaySocket } from './runners/relay-core'
import { readSettings, writeSettings } from './settings'

/** 개발 실행은 시험 서버를 쓸 수 있다(`MONITOR_RELAY_URL=ws://127.0.0.1:8787/api/relay`). */
const RELAY_URL =
  (!app.isPackaged && process.env.MONITOR_RELAY_URL) || 'wss://server.system.runners.im/api/relay'
/** 다른 컴퓨터가 보낼 수 있는 유일한 명령: 숫자 읽기. 끄기와 비우기는 사용자에게 먼저 묻는 휴대폰만 한다. */
const HOST_COMMANDS = new Set(['usage.get'])

/** 화면에 보이는 연결 상태. elsewhere: 다른 연결이 이 컴퓨터 자리를 가져갔거나 토큰이 다른 앱 것이다. 다시 연결을 누를 때까지 멈춘다. */
export type RelayStatus = 'signedOut' | 'connecting' | 'connected' | 'elsewhere'

/** 명령 하나: 받은 값으로 일을 하고 결과를 돌려주거나, 이유를 담아 던진다. */
export type Handler = (args: Record<string, unknown>) => Promise<unknown>

type Options = {
  /** `state` 로 보낼 지금 값. 아직 없으면 null. */
  state: () => unknown
  /** 휴대폰에 보일 이 컴퓨터 이름. */
  name: () => Promise<string>
  commands: Record<string, Handler>
}

let core: Relay | null = null
let shown: RelayStatus = 'signedOut'
const statusListeners = new Set<(status: RelayStatus) => void>()

export function currentStatus(): RelayStatus {
  return shown
}

export function onStatus(listener: (status: RelayStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** 지금 relay 에 있는 계정의 다른 컴퓨터. */
export function otherHosts(): { deviceId: string; name: string }[] {
  return (core?.peers('host') ?? []).map(({ deviceId, name }) => ({ deviceId, name }))
}

/** 계정의 다른 기기에 `name` 을 보내고 `timeoutMs` 까지 답을 기다린다. */
export function ask(
  to: string,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  return core ? core.ask(to, name, args, timeoutMs) : Promise.reject(new Error('offline'))
}

/** 계정의 휴대폰으로 알림을 보낸다. 끊겨 있으면 다시 붙을 때까지 잠시 기다린다. */
export function sendAlert(title: string, body: string): void {
  core?.alert(title, body)
}

/** 다른 연결이 자리를 가져간 뒤 사용자가 누른 「다시 연결」. */
export function reconnect(): void {
  core?.reconnect()
}

/** 처음 한 번 만들어 둔다. 휴대폰이 재시작 뒤에도 같은 컴퓨터로 보게 하려는 것이다. */
function deviceId(): string {
  return readSettings().deviceId ?? writeSettings({ deviceId: randomUUID() }).deviceId!
}

/** kit 의 다섯 상태를 화면의 네 상태로 줄인다. 끊겨서 다시 붙는 동안은 「연결 중」으로 보인다. */
function statusOf(relay: Relay): RelayStatus {
  const status = relay.status()
  if (status === 'stopped') {
    return 'elsewhere'
  }
  return status === 'offline' ? 'connecting' : status
}

/** 휴대폰 명령은 먼저 「받음」을 돌려준다. 큰 폴더 비우기는 몇 분 걸릴 수 있어, 휴대폰이 1분 만에 포기하지 않고 같은 id 의 최종 답을 기다린다.
 *  다른 컴퓨터는 바로 답이 오는 숫자만 물으므로 첫 답을 곧 결과로 받는다. */
function withReceipt(handler: Handler): RelayCommand {
  return (args, message) => {
    if (message.fromRole === 'viewer') {
      core?.send({
        type: 'result',
        to: message.from,
        id: message.id,
        ok: true,
        data: { pending: true }
      })
    }
    return handler(args)
  }
}

export function startRelay(options: Options): void {
  core = createRelay({
    url: RELAY_URL,
    projectName: 'MONITOR',
    role: 'host',
    account: { ...account, owner: account.current },
    deviceId,
    name: options.name,
    // Why: Node 의 WebSocket 은 머리글을 실을 수 있어 토큰이 주소(서버 기록)에 남지 않는다.
    // 시스템 서버는 User-Agent 없는 요청을 막으므로(403) Node 기본값에 기대지 않고 적는다.
    createSocket: (url, token) =>
      new WebSocket(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': `Monitor/${app.getVersion()}` }
      } as unknown as string[]) as unknown as RelaySocket,
    commands: Object.fromEntries(
      Object.entries(options.commands).map(([name, handler]) => [name, withReceipt(handler)])
    ),
    // Why: fromRole 은 서버가 채우므로 앱이 속일 수 없다.
    allow: (message) =>
      message.fromRole === 'viewer' ||
      (message.fromRole === 'host' && HOST_COMMANDS.has(message.name ?? '')),
    state: options.state,
    // Why: 숫자 읽기는 아무것도 바꾸지 않고, 다른 컴퓨터가 몇 초마다 묻는다.
    quietCommands: ['usage.get']
  })
  core.onStatus(() => {
    const next = core ? statusOf(core) : 'signedOut'
    if (next === shown) {
      return
    }
    shown = next
    for (const listener of statusListeners) {
      listener(next)
    }
  })
  core.start()
}
