// 설정 창 「출시 현황」 탭의 자료. 앱별 최신 판은 GitHub 공개 정보이고, 맥마다 깔린 판은 Monitor 끼리만 주고받아 서버에 남지 않는다.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReleaseApp, ReleaseBuild, ReleaseStatus } from '../preload/api'

const run = promisify(execFile)
const APPS = ['Split', 'Prompt', 'Monitor', 'Remote', 'Draw']
const READ_EVERY_MS = 10 * 60_000
// Why: GitHub 는 로그인 없는 요청을 한 시간에 60번만 받는다. 앱 다섯에 두 번씩이라 15분보다 자주 물으면 모자란다.
const KEEP_MS = 15 * 60_000

export type AppVersions = Record<string, string | null>

/** 앱 이름 → 깔린 판(안 깔렸으면 null). Mac 이 아니면 어디에 깔리는지 몰라 null 이다. */
let installed: AppVersions | null = null

export const installedApps = (): AppVersions | null => installed

async function readInstalled(): Promise<void> {
  const found = await Promise.all(
    APPS.map(async (name) => {
      try {
        const plist = `/Applications/${name}.app/Contents/Info.plist`
        const { stdout } = await run('plutil', [
          '-extract',
          'CFBundleShortVersionString',
          'raw',
          plist
        ])
        return [name, stdout.trim() || null] as const
      } catch {
        return [name, null] as const
      }
    })
  )
  installed = Object.fromEntries(found)
}

export function startInstalledApps(): void {
  if (process.platform !== 'darwin') {
    return
  }
  void readInstalled()
  setInterval(() => void readInstalled(), READ_EVERY_MS)
}

async function github(path: string): Promise<unknown> {
  const answer = await fetch(`https://api.github.com/repos/RUNNERS-IM/${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'RUNNERS-Monitor' },
    signal: AbortSignal.timeout(8000)
  })
  if (answer.status === 404) {
    return null
  }
  if (!answer.ok) {
    throw new Error(`GitHub ${answer.status}`)
  }
  return answer.json()
}

async function latestOf(name: string): Promise<string | null> {
  const release = (await github(`${name.toLowerCase()}/releases/latest`)) as {
    tag_name?: string
  } | null
  return release?.tag_name?.match(/\d+\.\d+\.\d+(?:\.\d+)?/)?.[0] ?? null
}

async function buildOf(name: string): Promise<ReleaseBuild> {
  const runs = (await github(`${name.toLowerCase()}/actions/runs?branch=release&per_page=1`)) as {
    workflow_runs?: { status: string; conclusion: string | null; updated_at: string }[]
  } | null
  const last = runs?.workflow_runs?.[0]
  if (!last) {
    return null
  }
  const result =
    last.status !== 'completed'
      ? 'running'
      : last.conclusion === 'success'
        ? 'success'
        : last.conclusion === 'cancelled'
          ? 'cancelled'
          : 'failure'
  return { result, at: Date.parse(last.updated_at) }
}

let kept: { at: number; staff: boolean; apps: ReleaseApp[] } | null = null

async function askGitHub(staff: boolean): Promise<ReleaseApp[]> {
  if (kept && kept.staff === staff && Date.now() - kept.at < KEEP_MS) {
    return kept.apps
  }
  const apps = await Promise.all(
    APPS.map(async (name): Promise<ReleaseApp> => {
      const before = kept?.apps.find((app) => app.name === name)
      // Why: 잠깐 GitHub 에 못 닿아도 앞서 읽은 판 번호를 지우지 않는다.
      const latest = await latestOf(name).then(
        (version) => ({ version, checked: true }),
        () => ({ version: before?.latest ?? null, checked: before?.checked ?? false })
      )
      const build = staff ? await buildOf(name).catch(() => before?.build ?? null) : undefined
      return { name, latest: latest.version, checked: latest.checked, build }
    })
  )
  kept = { at: Date.now(), staff, apps }
  return apps
}

export async function releaseStatus(
  staff: boolean,
  computers: ReleaseStatus['computers']
): Promise<ReleaseStatus> {
  return { apps: await askGitHub(staff), computers }
}
