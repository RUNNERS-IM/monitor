#!/usr/bin/env node
// 시스템 서버의 앱 로그인과 relay(docs/relay.md)를 이 컴퓨터 안에서 흉내 낸다. 진짜 서버 없이 컴퓨터판과 휴대폰판을 함께 시험하려는 것이다.
// 진짜 서버가 받을 비밀번호(영문과 숫자를 섞어 6~20자)면 어떤 이메일로도 로그인되고, 계정은 그 이메일이다.
// 성공 답은 진짜 서버처럼 { code, data } 로 감싼다. 푸시는 보내지 않고 찍기만 한다. 모두 메모리에만 있다.
//
//   node scripts/relay-dev.mjs [포트]                    (기본 8787, PORT 환경 변수도 받음)
//   컴퓨터: <앱>_API_URL=http://127.0.0.1:8787 pnpm dev
//   휴대폰: EXPO_PUBLIC_API_URL=http://<이 맥 주소>:8787 npx expo start
//   RELAY_DEV_EXPIRE=1 이면 계정마다 첫 연결을 4401 로 끊어 갱신 흐름을 시험한다.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787)
const expired = new Set()
const PROJECTS = ['SPLIT', 'MONITOR', 'REMOTE', 'PROMPT', 'DRAW']
/** token -> { account, project } */
const tokens = new Map()
/** account|project -> Map<deviceId, { ws, deviceId, name, role }> */
const rooms = new Map()
/** account|project -> Map<deviceId, last state data> */
const lastState = new Map()

function issue(account, project) {
  const accessToken = `dev-access-${randomUUID()}`
  const refreshToken = `dev-refresh-${randomUUID()}`
  tokens.set(accessToken, { account, project, kind: 'access' })
  tokens.set(refreshToken, { account, project, kind: 'refresh' })
  return { accessToken, refreshToken }
}

// 시스템 서버는 성공 답을 모두 { code, data } 로 감싼다.
const PASSWORD = /^(?=.*[a-zA-Z])(?=.*[0-9])[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};:,.<>?|]{6,20}$/

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(status < 400 ? { code: status, data: body } : body))
}

const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (req.url === '/api/mobile/auth/login' || req.url === '/api/mobile/auth/signup') {
      if (
        !body.email ||
        !PASSWORD.test(body.password ?? '') ||
        !PROJECTS.includes(body.projectName)
      ) {
        return json(res, 400, { error: 'bad request' })
      }
      return json(res, 200, {
        user: { id: body.email, email: body.email },
        tokens: issue(body.email, body.projectName)
      })
    }
    if (req.url === '/api/mobile/auth/refresh') {
      const found = tokens.get(body.refreshToken)
      if (!found || found.kind !== 'refresh') {
        return json(res, 401, { error: 'expired' })
      }
      tokens.delete(body.refreshToken)
      return json(res, 200, issue(found.account, found.project))
    }
    if (req.url === '/api/mobile/auth/logout') {
      tokens.delete(body.refreshToken)
      return json(res, 200, {})
    }
    if (req.url === '/api/mobile/devices') {
      if (tokens.get(bearer)?.kind !== 'access') {
        return json(res, 401, { error: 'expired' })
      }
      console.log('push token registered', body.platform, body.projectName)
      return json(res, 200, {})
    }
    json(res, 404, { error: 'not found' })
  })
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname !== '/api/relay') {
    return socket.destroy()
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url))
})

const peerOf = (d) => ({ deviceId: d.deviceId, name: d.name, role: d.role })
const send = (ws, message) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(message))

wss.on('connection', (ws, req, url) => {
  const token =
    (req.headers.authorization ?? '').replace(/^Bearer /, '') || url.searchParams.get('token')
  const owner = tokens.get(token)
  if (!owner || owner.kind !== 'access') {
    return ws.close(4401, 'unauthorized')
  }
  const key = `${owner.account}|${owner.project}`
  if (process.env.RELAY_DEV_EXPIRE && !expired.has(key)) {
    expired.add(key)
    return ws.close(4401, 'expired')
  }
  let me = null
  ws.on('message', (data) => {
    let m
    try {
      m = JSON.parse(String(data))
    } catch {
      return send(ws, { type: 'error', error: 'not json' })
    }
    if (m.type === 'hello') {
      if (m.projectName !== owner.project) {
        return ws.close(4403, 'wrong project')
      }
      const room = rooms.get(key) ?? new Map()
      rooms.set(key, room)
      room.get(m.deviceId)?.ws.close(4409, 'replaced')
      me = { ws, deviceId: m.deviceId, name: m.name, role: m.role }
      send(ws, { type: 'peers', peers: [...room.values()].map(peerOf) })
      for (const other of room.values()) {
        send(other.ws, { type: 'peer-joined', peer: peerOf(me) })
      }
      room.set(me.deviceId, me)
      if (me.role === 'viewer') {
        for (const [from, state] of lastState.get(key) ?? []) {
          send(ws, { type: 'state', from, data: state })
        }
      }
      console.log('hello', owner.account, me.role, me.name)
      return
    }
    if (!me) {
      return send(ws, { type: 'error', error: 'hello first' })
    }
    const room = rooms.get(key)
    if (m.type === 'state' && me.role === 'host') {
      const states = lastState.get(key) ?? new Map()
      lastState.set(key, states)
      states.set(me.deviceId, m.data)
      for (const other of room.values()) {
        if (other.role === 'viewer') {
          send(other.ws, { type: 'state', from: me.deviceId, data: m.data })
        }
      }
      return
    }
    if (m.type === 'alert' && me.role === 'host') {
      console.log('push:', m.title, '-', m.body)
      return
    }
    if (m.type === 'command' || m.type === 'result' || m.type === 'signal') {
      const target = room.get(m.to)
      if (!target) {
        if (m.type === 'command') {
          send(ws, { type: 'result', id: m.id, ok: false, data: { error: 'offline' } })
        }
        return
      }
      // 진짜 서버처럼 보낸 기기 id 와 hello 역할을 채운다. 앱이 휴대폰과 컴퓨터를 구별하려면 필요하다.
      send(target.ws, { ...m, from: me.deviceId, fromRole: me.role })
      return
    }
    send(ws, { type: 'error', error: `unknown type ${m.type}` })
  })
  ws.on('close', () => {
    const room = rooms.get(key)
    if (!me || room?.get(me.deviceId) !== me) {
      return
    }
    room.delete(me.deviceId)
    if (me.role === 'host') {
      lastState.get(key)?.delete(me.deviceId)
    }
    for (const other of room.values()) {
      send(other.ws, { type: 'peer-left', deviceId: me.deviceId })
    }
  })
})

server.listen(PORT, '0.0.0.0', () =>
  console.log(`relay-dev on http://127.0.0.1:${PORT} (ws /api/relay)`)
)
