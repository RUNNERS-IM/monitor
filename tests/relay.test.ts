import { beforeEach, expect, test, vi } from 'vitest'

type Sent = { type?: string; id?: string; ok?: boolean; data?: unknown }

const sockets: FakeSocket[] = []

class FakeSocket {
  readyState = 1
  sent: Sent[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(
    public url: string,
    public options: { headers: Record<string, string> }
  ) {
    sockets.push(this)
  }
  send(text: string) {
    this.sent.push(JSON.parse(text) as Sent)
  }
  close() {
    this.readyState = 3
  }
  hear(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '2.6.110701', getPath: () => '/nowhere' }
}))
vi.mock('../src/main/settings', () => ({
  readSettings: () => ({ deviceId: 'this-computer' }),
  writeSettings: () => ({})
}))
vi.mock('../src/main/account', () => ({
  accessToken: () => 'token',
  refresh: async () => ({ ok: true, token: 'token' }),
  current: () => 'someone@runners.im',
  onChange: () => () => undefined
}))

const flush = () => new Promise((done) => setTimeout(done, 0))

async function connected(commands: Record<string, () => Promise<unknown>>) {
  vi.resetModules()
  sockets.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  const relay = await import('../src/main/relay')
  relay.startRelay({ state: () => ({ cpu: 1 }), name: async () => 'm2-pro-1', commands })
  await flush()
  const socket = sockets[0]
  socket.onopen?.()
  await flush()
  socket.hear({ type: 'peers', peers: [{ deviceId: 'b', name: 'm2-pro-2', role: 'host' }] })
  await flush()
  return { relay, socket }
}

beforeEach(() => vi.useRealTimers())

test('토큰은 머리글로 보내고 User-Agent 를 적는다', async () => {
  const { socket } = await connected({})
  expect(socket.url).not.toContain('token')
  expect(socket.options.headers.Authorization).toBe('Bearer token')
  expect(socket.options.headers['User-Agent']).toBe('Monitor/2.6.110701')
})

test('연결되면 connected 로 보이고 다른 컴퓨터를 안다', async () => {
  const { relay } = await connected({})
  expect(relay.currentStatus()).toBe('connected')
  expect(relay.otherHosts()).toEqual([{ deviceId: 'b', name: 'm2-pro-2' }])
})

test('휴대폰 명령은 받음을 먼저 보내고 같은 id 로 결과를 보낸다', async () => {
  const { socket } = await connected({ 'app.quit': async () => ({ ended: true }) })
  socket.hear({ type: 'command', from: 'phone', fromRole: 'viewer', id: 'x', name: 'app.quit' })
  await flush()
  const results = socket.sent.filter((message) => message.type === 'result' && message.id === 'x')
  expect(results.map((message) => message.data)).toEqual([{ pending: true }, { ended: true }])
})

test('다른 컴퓨터의 숫자 읽기는 첫 답이 곧 결과이고, 끄기는 받음 뒤 결과가 간다', async () => {
  const quit = vi.fn(async () => ({ gone: true }))
  const { socket } = await connected({ 'usage.get': async () => ({ cpu: 9 }), 'app.quit': quit })
  socket.hear({ type: 'command', from: 'b', fromRole: 'host', id: 'read', name: 'usage.get' })
  socket.hear({ type: 'command', from: 'b', fromRole: 'host', id: 'quit', name: 'app.quit' })
  await flush()
  const results = (id: string) =>
    socket.sent.filter((message) => message.type === 'result' && message.id === id)
  expect(results('read').map((message) => message.data)).toEqual([{ cpu: 9 }])
  expect(results('quit').map((message) => message.data)).toEqual([
    { pending: true },
    { gone: true }
  ])
  expect(quit).toHaveBeenCalledOnce()
})

test('계정의 기기가 아닌 쪽이 보낸 명령은 받지 않는다', async () => {
  const quit = vi.fn(async () => null)
  const { socket } = await connected({ 'app.quit': quit })
  socket.hear({ type: 'command', from: 'x', fromRole: 'unknown', id: 'quit', name: 'app.quit' })
  socket.hear({ type: 'command', from: 'b', fromRole: 'host', id: 'other', name: 'shell.run' })
  await flush()
  expect(
    socket.sent.filter((message) => message.type === 'result').every((message) => !message.ok)
  ).toBe(true)
  expect(quit).not.toHaveBeenCalled()
})

test('숫자 읽기 뒤에는 state 를 다시 보내지 않고, 다른 명령 뒤에는 보낸다', async () => {
  const { socket } = await connected({
    'usage.get': async () => null,
    'app.quit': async () => null
  })
  const states = () => socket.sent.filter((message) => message.type === 'state').length
  const before = states()
  socket.hear({ type: 'command', from: 'b', fromRole: 'host', id: 'a', name: 'usage.get' })
  await flush()
  expect(states()).toBe(before)
  socket.hear({ type: 'command', from: 'p', fromRole: 'viewer', id: 'b', name: 'app.quit' })
  await flush()
  expect(states()).toBe(before + 1)
})

test('자리를 빼앗기면 elsewhere 로 보이고 스스로 다시 붙지 않는다', async () => {
  const { relay, socket } = await connected({})
  socket.onclose?.({ code: 4409 })
  await flush()
  expect(relay.currentStatus()).toBe('elsewhere')
  expect(sockets).toHaveLength(1)
  relay.reconnect()
  await new Promise((done) => setTimeout(done, 5))
  expect(sockets).toHaveLength(2)
})
