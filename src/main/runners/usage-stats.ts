// 앱 사용 통계: 동의 여부를 저장하고, 동의한 사람의 기능 사용 횟수를 날짜별로 모아 서버에 보낸다.
// Electron 을 직접 불러오지 않고 파일 위치와 토큰을 받는다. 동의하지 않으면 세지도 보내지도 않는다.
import { randomUUID } from 'node:crypto'
import { createSettingsFile } from './settings-file'

/** 시스템 서버의 받는 주소. 앱 이름과 계정은 서버가 토큰에서 읽는다. */
export const USAGE_ENDPOINT = 'https://server.system.runners.im/api/mobile/usage'

const TIMEOUT_MS = 15_000
const MAX_DAYS = 30
const MAX_FEATURES_PER_DAY = 50
const SAVE_EVERY_MS = 60_000
// 이름에 파일 경로나 입력 글이 섞여 나가지 않게, 정해진 모양의 기능 이름만 센다.
const FEATURE_NAME = /^[a-z0-9][a-z0-9.]{0,39}$/

export type UsageConsent = 'unasked' | 'granted' | 'denied'
export type UsageDays = Record<string, Record<string, number>>
export type UsageFlushResult = 'sent' | 'nothing' | 'off' | 'signedOut' | 'failed'

type Saved = {
  consent: UsageConsent
  decidedAt: string | null
  days: UsageDays
  deviceId: string | null
  /** 동의를 거뒀는데 서버 기록을 아직 못 지웠다. 다음 flush 때 다시 지운다. */
  deleteOnServer: boolean
}

/** 하루 치 하나를 보내는 몸통. */
export function usagePayload(
  day: string,
  version: string,
  deviceId: string,
  counts: Record<string, number>
): unknown {
  return { day, version, deviceId, counts }
}

export type UsageStatsOptions = {
  version: string
  /** 동의 여부와 모은 횟수를 둘 파일. 보통 userData 안의 usage-stats.json */
  filePath: string
  /** 로그인한 계정의 토큰. 로그아웃 상태면 null */
  token: () => string | null | Promise<string | null>
  /** 시험할 때 바꿔 끼운다. */
  endpoint?: string | null
  fetch?: typeof fetch
  now?: () => Date
}

export type UsageStats = ReturnType<typeof createUsageStats>

export function createUsageStats(options: UsageStatsOptions) {
  const file = createSettingsFile<Saved>(options.filePath, {
    consent: 'unasked',
    decidedAt: null,
    days: {},
    deviceId: null,
    deleteOnServer: false
  })
  const endpoint = options.endpoint === undefined ? USAGE_ENDPOINT : options.endpoint
  const request = options.fetch ?? fetch
  const now = options.now ?? (() => new Date())
  const saved = file.read()
  let consent = saved.consent
  let days = saved.days
  let deviceId = saved.deviceId
  let deleteOnServer = saved.deleteOnServer
  let lastSave = 0
  let flushing: Promise<UsageFlushResult> | null = null

  // 서버 규격: day 는 기기 시각 기준 날짜다.
  const today = () => {
    const at = now()
    const two = (n: number) => String(n).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }

  const trim = () => {
    for (const day of Object.keys(days).sort().slice(0, -MAX_DAYS)) {
      delete days[day]
    }
  }

  const save = () => {
    trim()
    file.write({ days })
    lastSave = now().getTime()
  }

  const removeFromServer = async (url: string, token: string): Promise<boolean> => {
    try {
      const response = await request(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      // 404 는 받는 곳이 아직 없다는 뜻이고, 그러면 서버에 지울 기록도 없다.
      return response.ok || response.status === 404
    } catch {
      return false
    }
  }

  const postDay = async (url: string, token: string, day: string): Promise<boolean> => {
    try {
      const response = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(usagePayload(day, options.version, deviceId ?? '', days[day])),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      return response.ok
    } catch {
      return false
    }
  }

  const send = async (): Promise<UsageFlushResult> => {
    if (endpoint === null) {
      return 'off'
    }
    if (deleteOnServer) {
      const token = await options.token()
      if (!token) {
        return 'signedOut'
      }
      if (!(await removeFromServer(endpoint, token))) {
        return 'failed'
      }
      deleteOnServer = false
      file.write({ deleteOnServer })
    }
    if (consent !== 'granted') {
      return 'off'
    }
    // 오늘 치는 아직 늘어나므로, 끝난 날만 보낸다. 서버가 같은 날을 덮어쓰므로 실패하면 그대로 다시 보낸다.
    const finished = Object.keys(days)
      .filter((day) => day < today())
      .sort()
    if (finished.length === 0) {
      return 'nothing'
    }
    const token = await options.token()
    if (!token) {
      return 'signedOut'
    }
    for (const day of finished) {
      if (!(await postDay(endpoint, token, day))) {
        save()
        return 'failed'
      }
      // 보내는 사이에 동의를 거두면 days 는 이미 비어 있다.
      delete days[day]
    }
    save()
    return 'sent'
  }

  const flush = (): Promise<UsageFlushResult> => {
    flushing ??= send().finally(() => {
      flushing = null
    })
    return flushing
  }

  return {
    consent: () => consent,
    /** 처음 켠 뒤 동의 창을 띄워야 하는가. 한 번 답하면 다시 묻지 않는다. */
    shouldAsk: () => consent === 'unasked',
    /** 동의 창과 설정의 스위치가 부른다. 동의를 거두면 아직 안 보낸 횟수와 서버 기록을 지운다. */
    setConsent(granted: boolean) {
      const withdrawn = consent === 'granted' && !granted
      consent = granted ? 'granted' : 'denied'
      if (granted) {
        deviceId ??= randomUUID()
      } else {
        days = {}
        deviceId = null
      }
      deleteOnServer ||= withdrawn
      file.write({ consent, decidedAt: now().toISOString(), days, deviceId, deleteOnServer })
      lastSave = now().getTime()
      if (withdrawn) {
        void flush()
      }
    },
    /** 기능 하나를 쓸 때 부른다. 이름은 소문자 · 숫자 · 점만, 40자까지 받고 하루 50가지까지 센다. */
    count(feature: string, times = 1) {
      if (consent !== 'granted' || !FEATURE_NAME.test(feature) || !(times > 0)) {
        return
      }
      const day = (days[today()] ??= {})
      if (!(feature in day) && Object.keys(day).length >= MAX_FEATURES_PER_DAY) {
        return
      }
      day[feature] = (day[feature] ?? 0) + Math.floor(times)
      if (now().getTime() - lastSave >= SAVE_EVERY_MS) {
        save()
      }
    },
    /** 앱을 끄기 전에 불러 아직 파일에 안 쓴 횟수를 남긴다. */
    save() {
      if (consent === 'granted') {
        save()
      }
    },
    /** 앱을 켤 때와 하루에 한 번쯤 부른다. 동시에 불러도 한 번만 보낸다. */
    flush
  }
}
