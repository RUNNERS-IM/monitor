// 사용 통계: kit 의 createUsageStats 에 Monitor 의 파일 위치와 계정 토큰을 넘긴다. 동의하지 않으면 세지도 보내지도 않는다.
import { app } from 'electron'
import { join } from 'node:path'
import * as account from './account'
import { createUsageStats, type UsageStats } from './runners/usage-stats'

const DAY_MS = 24 * 60 * 60 * 1000

let made: UsageStats | null = null

// Why: 개발 실행은 index.ts 가 userData 를 바꾸므로 처음 쓸 때 만든다.
function stats(): UsageStats {
  made ??= createUsageStats({
    version: app.getVersion(),
    filePath: join(app.getPath('userData'), 'usage-stats.json'),
    // Why: 켜 둔 지 오래된 앱의 액세스 토큰은 만료돼 있다. 보낼 것이 있을 때만 불리므로 그때 새로 받는다.
    token: async () => {
      const result = await account.refresh()
      return result.ok ? result.token : null
    },
    // Why: 개발 실행은 시험 서버로 보낼 수 있다(`MONITOR_USAGE_URL=http://127.0.0.1:8790/usage`).
    endpoint: (!app.isPackaged && process.env.MONITOR_USAGE_URL) || undefined
  })
  return made
}

export const shouldAsk = () => stats().shouldAsk()
export const granted = () => stats().consent() === 'granted'
export const setConsent = (on: boolean) => stats().setConsent(on)
export const count = (feature: string) => stats().count(feature)
export const save = () => stats().save()

// Why: 받는 주소가 아직 운영에 없어 실패(404)할 수 있다. 횟수는 파일에 남아 다음에 다시 보낸다.
const flush = () => void stats().flush().catch(() => undefined)

/** 앱을 켤 때와 하루에 한 번 끝난 날의 횟수를 보낸다. */
export function startUsage(): void {
  flush()
  setInterval(flush, DAY_MS)
}
